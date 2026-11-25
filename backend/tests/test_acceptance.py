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
from fastapi import HTTPException, UploadFile
from PIL import Image

from backend.config import MAX_VIDEO_BYTES, ROOT
from backend.database import store
from backend.main import app
from backend.routers.detection import detect_video
from backend.schemas import InferenceOptions
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

    def test_video_resolution_matrix_real_inference_and_h264_export(self):
        sizes = [(1280, 720), (1920, 1080), (2560, 1440), (3840, 2160),
                 (2160, 3840), (3000, 1000), (1000, 3000), (641, 431), (3000, 3000)]
        original_annotate = video.annotate
        rendered_sizes = []

        def checked_annotate(image, rows):
            for row in rows:
                self.assertIn(row['kelas'], {'EmptyChair', 'OccupiedChair'})
                self.assertTrue(0 <= row['x1'] < row['x2'] <= image.width)
                self.assertTrue(0 <= row['y1'] < row['y2'] <= image.height)
            result = original_annotate(image, rows)
            self.assertEqual(result.size, image.size)
            rendered_sizes.append(image.size)
            return result

        for i, (width, height) in enumerate(sizes):
            with self.subTest(size=(width, height)):
                clip = self.data / f'resolution-{i}.mp4'
                subprocess.run([
                    imageio_ffmpeg.get_ffmpeg_exe(), '-loglevel', 'error', '-y', '-loop', '1',
                    '-i', str(FIXTURE), '-vf',
                    f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2',
                    '-t', '1', '-r', '2', '-pix_fmt', 'yuv444p', '-c:v', 'libx264', '-threads', '1', str(clip),
                ], check=True)
                with patch.object(video, 'annotate', side_effect=checked_annotate):
                    response = self.client.post('/api/detect/video', files={'file': (clip.name, clip.read_bytes())},
                                                data={'sample_every': 2, 'device': 'auto' if i % 2 else 'cpu',
                                                      'resolution': 480, 'confidence': 0.3})
                    self.assertEqual(response.status_code, 202, response.text)
                    key = response.json()['id']
                    deadline = time.monotonic() + 60
                    while time.monotonic() < deadline:
                        job = self.client.get(f'/api/jobs/{key}').json()
                        if job['status'] in {'completed', 'error'}:
                            break
                        time.sleep(0.1)
                self.assertEqual(job['status'], 'completed', job.get('error'))
                target = video.processing_size(width, height)
                self.assertEqual(rendered_sizes[-1], target)
                self.assertEqual((job['metadata']['width'], job['metadata']['height']), (width, height))
                self.assertEqual(job['metadata']['resized'], target != (width, height))
                self.assertEqual(job['sample_every'], 2)
                self.assertEqual(job['duration'], 1)
                self.assertEqual(len(job['frames']), 1)
                self.assertEqual(job['frames'][0]['playback_seconds'], 0)
                summary = job['frames'][0]
                self.assertEqual(summary['total'], summary['empty'] + summary['occupied'])
                download = self.client.get(f'/api/jobs/{key}/video')
                self.assertEqual(download.status_code, 200)
                output = self.data / f'output-{i}.mp4'
                output.write_bytes(download.content)
                capture = cv2.VideoCapture(str(output))
                try:
                    self.assertTrue(capture.read()[0])
                    self.assertEqual(capture.get(cv2.CAP_PROP_FRAME_WIDTH), target[0] + target[0] % 2)
                    self.assertEqual(capture.get(cv2.CAP_PROP_FRAME_HEIGHT), target[1] + target[1] % 2)
                    self.assertEqual(capture.get(cv2.CAP_PROP_FPS), 1)
                    self.assertEqual(capture.get(cv2.CAP_PROP_FRAME_COUNT), 1)
                finally:
                    capture.release()
                history = self.client.get('/api/history', params={'source': 'video', 'q': key}).json()
                self.assertEqual(history['count'], 1)
                detail = self.client.get(f"/api/history/{history['items'][0]['id']}").json()
                self.assertEqual(detail['details']['video_metadata'], job['metadata'])
                export = self.client.get('/api/history/export', params={'source': 'video', 'q': key})
                self.assertEqual(len(list(csv.DictReader(io.StringIO(export.content.decode('utf-8-sig'))))), 1)
                self.assertFalse(any((self.data / 'jobs').glob(f'{key}.input.*')))

    def test_video_rejects_oversize_long_and_corrupt_files_and_cleans_uploads(self):
        # Exercise the real 150 MB limit from disk, without building a huge multipart body in memory.
        with (self.data / 'large.mp4').open('w+b') as source:
            source.write(b'\0\0\0\x18ftyp')
            source.truncate(MAX_VIDEO_BYTES + 1)
            source.seek(0)
            with self.assertRaises(HTTPException) as rejected:
                detect_video(UploadFile(filename='large.mp4', file=source), InferenceOptions(), 10)
        self.assertEqual(rejected.exception.status_code, 413)
        corrupt = self.client.post('/api/detect/video', files={'file': ('broken.mp4', b'\0\0\0\x18ftyp' + b'x' * 33)})
        self.assertEqual(corrupt.status_code, 422)
        unsupported = self.client.post('/api/detect/video', files={'file': ('clip.webm', b'unsupported')})
        self.assertEqual(unsupported.status_code, 422)
        clip = self.data / 'long.mp4'
        subprocess.run([
            imageio_ffmpeg.get_ffmpeg_exe(), '-loglevel', 'error', '-y', '-f', 'lavfi',
            '-i', 'color=size=16x16:rate=1', '-t', '601', '-c:v', 'libx264', str(clip),
        ], check=True)
        too_long = self.client.post('/api/detect/video', files={'file': (clip.name, clip.read_bytes())})
        self.assertEqual(too_long.status_code, 422)
        self.assertIn('10 menit', too_long.json()['detail'])
        self.assertFalse(any((self.data / 'jobs').glob('*.input.*')))

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
