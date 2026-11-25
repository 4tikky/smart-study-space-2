import base64
import io
import logging
import os
from pathlib import Path
from threading import Lock, Thread
from time import perf_counter

from PIL import ImageDraw, ImageFont

from backend.schemas import InferenceOptions
from inference import LABELS, MODEL_PATH, detection_rows, summarize

log = logging.getLogger(__name__)
BOX_COLORS = {"EmptyChair": "#22C55E", "OccupiedChair": "#EF4444"}


class ModelUnavailable(RuntimeError):
    pass


class ModelService:
    def __init__(self):
        self.model = None
        self.status = "loading"
        self.device = None
        self.lock = Lock()

    def start(self):
        Thread(target=self.load, name="load-yolo", daemon=True).start()

    def load(self):
        try:
            for variable in ("YOLO_CONFIG_DIR", "MPLCONFIGDIR"):
                Path(os.environ[variable]).mkdir(parents=True, exist_ok=True)
            from ultralytics import YOLO

            if not MODEL_PATH.is_file():
                raise FileNotFoundError(MODEL_PATH.name)
            model = YOLO(str(MODEL_PATH), task="detect")
            if set(model.names.values()) != set(LABELS):
                raise ValueError("Kelas model tidak sesuai.")
            self.model = model
            self.device = str(model.device)
            self.status = "ready"
        except Exception:
            self.status = "error"
            log.exception("Gagal memuat model kursi")

    def info(self):
        return {
            "architecture": "YOLO26s", "file": MODEL_PATH.name,
            "classes": list(LABELS), "status": self.status,
            "device": self.device, "defaults": InferenceOptions().model_dump(),
        }

    def predict(self, image, options):
        if self.status != "ready":
            message = "Model sedang dimuat." if self.status == "loading" else "Model gagal dimuat. Periksa weights.pt dan dependensi."
            raise ModelUnavailable(message)
        import torch

        use_cuda = options.device == "auto" and torch.cuda.is_available()
        device = "cuda:0" if use_cuda else "cpu"
        with self.lock, torch.inference_mode():
            # Ultralytics caches its predictor. Recreate it only on device changes.
            if str(self.model.device) != device:
                self.model.to(device)
                self.model.predictor = None
            started = perf_counter()
            result = self.model.predict(
                source=image, conf=options.confidence, imgsz=options.resolution,
                device=device, verbose=False, save=False,
            )[0]
            rows = detection_rows(result)
            self.device = str(self.model.device)
            elapsed = round((perf_counter() - started) * 1000, 2)
        return {"rows": rows, "summary": summarize(rows), "elapsed_ms": elapsed,
                "device": device, "width": image.width, "height": image.height}


def annotate(image, rows):
    output = image.copy()
    draw = ImageDraw.Draw(output)
    scale = max(image.size)
    font = ImageFont.load_default(size=max(12, round(scale / 60)))
    for row in rows:
        color = BOX_COLORS[row["kelas"]]
        x, y, x2, y2 = (row[key] for key in ("x1", "y1", "x2", "y2"))
        draw.rectangle((x, y, x2, y2), outline=color, width=max(2, round(scale / 300)))
        label = f"{row['status']} {row['confidence']:.0%}"
        width = draw.textlength(label, font=font) + 10
        height = font.size + 8
        left = max(0, min(x, image.width - width))
        top = max(0, y - height)
        draw.rectangle((left, top, left + width, top + height), fill=color)
        draw.text((left + 5, top + height / 2), label, fill="#0F172A", font=font, anchor="lm")
    return output


def data_url(image, fmt="JPEG"):
    out = io.BytesIO()
    image.save(out, format=fmt, **({"quality": 85} if fmt == "JPEG" else {}))
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(out.getvalue()).decode()


model = ModelService()
