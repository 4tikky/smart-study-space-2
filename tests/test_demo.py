"""Small offline checks, including the real checkpoint through Streamlit."""

import csv
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch
from PIL import Image
from streamlit.testing.v1 import AppTest
from inference import (BASE_DIR, CSV_COLUMNS, LABELS, MAX_IMAGE_PIXELS,
                       annotate, csv_bytes, detection_rows, image_bytes,
                       read_image, summarize)
from ultralytics.engine.results import Results


class DemoTests(unittest.TestCase):
    def test_image_roundtrip_and_invalid_input(self):
        original = Image.new("RGB", (48, 32), (40, 100, 160))
        decoded = read_image(image_bytes(original))
        self.assertEqual(decoded.size, original.size)
        self.assertEqual(decoded.getpixel((0, 0)), (40, 100, 160))
        for invalid in (b"", b"not an image"):
            with self.subTest(data=invalid), self.assertRaises(ValueError):
                read_image(invalid)
        with self.assertRaises(ValueError):
            read_image(b"x" * (20 * 1024 * 1024 + 1))
        with patch("inference.MAX_IMAGE_PIXELS", 100), self.assertRaises(ValueError):
            read_image(image_bytes(original))
        self.assertGreater(MAX_IMAGE_PIXELS, 100)

    def test_exif_orientation_and_transparency(self):
        source = Image.new("RGB", (30, 20), "red")
        exif = source.getexif()
        exif[274] = 6
        buffer = io.BytesIO()
        source.save(buffer, "JPEG", exif=exif)
        self.assertEqual(read_image(buffer.getvalue()).size, (20, 30))
        transparent = Image.new("RGBA", (10, 10), (255, 0, 0, 0))
        self.assertEqual(read_image(image_bytes(transparent)).getpixel((0, 0)), (255, 255, 255))

    def test_detection_counts_csv_and_annotation(self):
        import numpy as np

        source = Image.new("RGB", (640, 480), "white")
        result = Results(np.asarray(source), path="synthetic.png", names={0: "EmptyChair", 1: "OccupiedChair"},
                         boxes=torch.tensor([[10, 30, 100, 200, .9, 0], [200, 30, 400, 220, .8, 1]]))
        rows = detection_rows(result)
        self.assertEqual(summarize(rows), {"empty": 1, "occupied": 1, "total": 2, "occupancy": .5})
        decoded_csv = list(csv.DictReader(io.StringIO(csv_bytes(rows).decode("utf-8-sig"))))
        self.assertEqual(len(decoded_csv), 2)
        self.assertEqual(decoded_csv[0]["kelas"], "EmptyChair")
        self.assertAlmostEqual(float(decoded_csv[0]["confidence"]), .9, places=5)
        self.assertEqual(annotate(source, rows, True).size, source.size)
        self.assertEqual(source.getpixel((10, 30)), (255, 255, 255))
        self.assertNotEqual(annotate(source, rows, False).getpixel((10, 30)), (255, 255, 255))

    def test_empty_detections(self):
        self.assertEqual(summarize([]), {"empty": 0, "occupied": 0, "total": 0, "occupancy": None})
        self.assertEqual(csv_bytes([]).decode("utf-8-sig").strip(), ",".join(CSV_COLUMNS))
        import numpy as np

        result = Results(orig_img=np.zeros((10, 10, 3), dtype=np.uint8),
                         path="empty.png", names={0: "EmptyChair"})
        self.assertEqual(detection_rows(result), [])

    def test_streamlit_initial_and_camera(self):
        app = AppTest.from_file(str(BASE_DIR / "app.py"), default_timeout=60).run()
        self.assertEqual(len(app.exception), 0)
        self.assertIn("Deteksi kursi", app.title[0].value)
        app.radio[0].set_value("Kamera").run()
        self.assertEqual(len(app.exception), 0)
        self.assertEqual(len(app.get("camera_input")), 1)

    def test_streamlit_real_model_inference_and_stale_result(self):
        app = AppTest.from_file(str(BASE_DIR / "app.py"), default_timeout=120).run()
        app.file_uploader[0].set_value(
            ("synthetic.png", image_bytes(Image.new("RGB", (640, 480), "white")), "image/png")
        ).run()
        self.assertEqual(len(app.exception), 0)
        app.button[0].click().run()
        self.assertEqual(len(app.exception), 0)
        self.assertEqual(len(app.error), 0)
        output = app.session_state["last_analysis"]["output"]
        self.assertEqual(output["annotated"].size, (640, 480))
        self.assertEqual(output["summary"]["total"], len(output["rows"]))
        self.assertTrue(all(row["kelas"] in LABELS for row in output["rows"]))
        self.assertGreater(output["elapsed_seconds"], 0)
        self.assertEqual(len(app.metric), 4)
        self.assertEqual(len(app.get("download_button")), 2)
        app.slider[0].set_value(.5).run()
        self.assertEqual(len(app.exception), 0)
        self.assertNotIn("last_analysis", app.session_state)
        self.assertEqual(len(app.metric), 0)

    def test_streamlit_rejects_corrupt_upload(self):
        app = AppTest.from_file(str(BASE_DIR / "app.py"), default_timeout=60).run()
        app.file_uploader[0].set_value(("bad.png", b"corrupt image", "image/png")).run()
        self.assertEqual(len(app.exception), 0)
        self.assertEqual(len(app.error), 1)
        self.assertIn("tidak dapat dibaca", app.error[0].value)


if __name__ == "__main__":
    unittest.main()
