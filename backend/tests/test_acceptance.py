"""Run with: python -m unittest discover -s backend/tests -v."""

import base64
import csv
import io
import logging
import subprocess
import tempfile
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import cv2
import imageio_ffmpeg
from fastapi.testclient import TestClient
from PIL import Image

from backend.config import ROOT
from backend.database import store
from backend.main import app
from backend.services import video

logging.getLogger("httpx").setLevel(logging.WARNING)

FIXTURE = ROOT / "frontend" / "public" / "library-study-room.webp"


class AcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stack = ExitStack()
        cls.addClassCleanup(cls.stack.close)
        cls.data = Path(cls.stack.enter_context(tempfile.TemporaryDirectory()))
        cls.stack.enter_context(patch.object(store, "DATABASE", cls.data / "test.sqlite3"))
        cls.stack.enter_context(patch.object(video, "TEMP_DIR", cls.data / "jobs"))
        # The upload router uses the same isolated job directory.
        cls.stack.enter_context(patch("backend.routers.detection.TEMP_DIR", cls.data / "jobs"))
        cls.client = cls.stack.enter_context(TestClient(app))
        expiry = time.monotonic() + 40
        while time.monotonic() < expiry:
            status = cls.client.get("/api/model/info").json()["status"]
            if status == "ready":
                return
            if status == "error":
                break
            time.sleep(0.15)
        raise RuntimeError("The original YOLO checkpoint did not load.")

    def test_real_image_detection_boxes_and_history(self):
        invalid = self.client.post("/api/detect/image", files={"file": ("invalid.jpg", b"broken")})
        self.assertEqual(invalid.status_code, 422)
        response = self.client.post("/api/detect/image", files={"file": ("library.webp", FIXTURE.read_bytes())},
                                    data={"confidence": 0.25, "resolution": 640, "device": "cpu"})
        self.assertEqual(response.status_code, 200, response.text[:200])
        body = response.json()
        rows = body["rows"]
        self.assertGreater(len(rows), 0)
        summary = body["summary"]
        self.assertEqual(summary["total"], len(rows))
        self.assertEqual(summary["empty"], sum(row["kelas"] == "EmptyChair" for row in rows))
        self.assertEqual(summary["occupied"], sum(row["kelas"] == "OccupiedChair" for row in rows))
        self.assertAlmostEqual(summary["occupancy"], summary["occupied"] / summary["total"])
        self.assertTrue(all(0.25 <= row["confidence"] <= 1 for row in rows))
        self.assertTrue(all(0 <= row["x1"] < row["x2"] <= body["width"] for row in rows))
        self.assertTrue(all(0 <= row["y1"] < row["y2"] <= body["height"] for row in rows))
        png = base64.b64decode(body["annotated"].split(",", 1)[1])
        with Image.open(io.BytesIO(png)) as annotated:
            self.assertEqual(annotated.size, (body["width"], body["height"]))
            colors = annotated.getcolors(annotated.width * annotated.height)
            self.assertIn((34, 197, 94), {color for _, color in colors})
        detail = self.client.get(f"/api/history/{body['history_id']}").json()
        self.assertEqual(detail["details"]["rows"], rows)
        export = self.client.get("/api/history/export", params={"source": "image", "q": body["session_id"]})
        self.assertEqual([entry["session_id"] for entry in csv.DictReader(io.StringIO(export.content.decode("utf-8-sig")))],
                         [body["session_id"]])

    def test_video_job_frame_timestamps_and_download(self):
        clip = self.data / "input.mp4"
        subprocess.run([
            imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-y", "-loop", "1",
            "-i", str(FIXTURE), "-vf", "scale=640:430", "-t", "1.5", "-r", "10",
            "-pix_fmt", "yuv420p", "-c:v", "libx264", str(clip),
        ], check=True)
        rejected = self.client.post("/api/detect/video", files={"file": ("bad.mov", b"invalid")})
        self.assertEqual(rejected.status_code, 422)
        response = self.client.post("/api/detect/video", files={"file": (clip.name, clip.read_bytes())},
                                    data={"sample_every": 5})
        self.assertEqual(response.status_code, 202, response.text)
        key = response.json()["id"]
        for _ in range(240):
            job = self.client.get(f"/api/jobs/{key}").json()
            if job["status"] in {"completed", "error"}:
                break
            time.sleep(0.15)
        self.assertEqual(job["status"], "completed", job.get("error"))
        self.assertEqual([frame["seconds"] for frame in job["frames"]], [0, 0.5, 1.0])
        self.assertTrue(all(frame["total"] > 0 for frame in job["frames"]))
        download = self.client.get(f"/api/jobs/{key}/video")
        self.assertEqual(download.headers["content-type"], "video/mp4")
        output = self.data / "downloaded.mp4"
        output.write_bytes(download.content)
        capture = cv2.VideoCapture(str(output))
        try:
            self.assertTrue(capture.read()[0])
            self.assertEqual(capture.get(cv2.CAP_PROP_FRAME_COUNT), len(job["frames"]))
        finally:
            capture.release()
        self.assertEqual(self.client.get("/api/history", params={"source": "video", "q": key}).json()["count"], 1)

    def test_websocket_multiple_frames_update_student_then_go_offline(self):
        initial = self.client.get("/api/occupancy").json()
        self.assertIsNone(initial["summary"])
        self.assertEqual(initial["floors"][0]["connection"], "unconfigured")
        zone = self.client.post("/api/zones", json={"floor_id": 1, "name": "Meja Utara", "layout_row": 1,
                                                    "layout_col": 2, "outlets": 4}).json()
        camera = self.client.post("/api/cameras", json={"floor_id": 1, "zone_id": zone["id"], "kind": "browser",
                                                         "name": "Webcam QA", "interval_ms": 250})
        self.assertEqual(camera.status_code, 201)
        camera_id = camera.json()["id"]
        self.assertEqual(self.client.get("/api/floors").json()[0]["connection"], "offline")
        with Image.open(FIXTURE) as image:
            image.thumbnail((900, 900))
            data = io.BytesIO()
            image.save(data, "JPEG", quality=84)
        with self.client.websocket_connect("/ws/live-detection") as socket:
            socket.send_json({"camera_id": camera_id, "interval_ms": 250})
            ready = socket.receive_json()
            self.assertEqual(ready["type"], "ready")
            results = []
            for _ in range(4):
                socket.send_bytes(data.getvalue())
                item = socket.receive_json()
                self.assertEqual(item["type"], "frame")
                self.assertGreater(item["summary"]["total"], 0)
                results.append(item)
            self.assertIsNotNone(results[-1]["fps"])
            self.assertEqual([row["track_id"] for row in results[0]["rows"]],
                             [row["track_id"] for row in results[-1]["rows"]])
            campus = self.client.get("/api/occupancy").json()
            self.assertEqual(campus["summary"], results[-1]["smoothed"])
            self.assertEqual(campus["floors"][0]["zones"][0]["connection"], "online")
            self.assertEqual(campus["floors"][1]["connection"], "unconfigured")
            self.assertNotIn("data:image", str(campus))
            self.assertIsNotNone(self.client.get("/api/operator/monitoring").json()["preview"])
            socket.send_text("stop")
            self.assertEqual(socket.receive()["type"], "websocket.close")
        self.assertEqual(self.client.get("/api/floors").json()[0]["connection"], "offline")
        self.assertIsNone(self.client.get("/api/occupancy").json()["summary"])
        history = self.client.get("/api/history", params={"source": "live", "camera": camera_id}).json()
        self.assertGreater(history["count"], 0)
        self.assertEqual(history["items"][0]["session_id"], ready["session_id"])
        analytics = self.client.get("/api/analytics").json()
        self.assertGreater(analytics["count"], 0)
        self.assertIn("Lantai 1", [item["label"] for item in analytics["floors"]])
        self.assertEqual(self.client.delete("/api/floors/1").status_code, 204)
        self.assertEqual(self.client.get("/api/cameras").json(), [])
        self.assertGreater(self.client.get("/api/history", params={"camera": camera_id}).json()["count"], 0)
