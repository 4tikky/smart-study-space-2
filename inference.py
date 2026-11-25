"""Image validation, real YOLO inference, and downloadable detection results."""

from __future__ import annotations

import csv
import io
import warnings
from pathlib import Path
from time import perf_counter
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError
# Keep Pillow validation independent of Ultralytics optional HEIF auto-install.
from PIL.Image import open as open_image

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "weights.pt"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
LABELS = {"EmptyChair": "Kursi kosong", "OccupiedChair": "Kursi terisi"}
COLORS = {"EmptyChair": "#346538", "OccupiedChair": "#965027"}
CSV_COLUMNS = ["id", "kelas", "status", "confidence", "x1", "y1", "x2", "y2"]


def read_image(data: bytes) -> Image.Image:
    """Validate uploaded bytes before decoding; normalize EXIF and transparency."""
    if not data:
        raise ValueError("File gambar kosong. Pilih gambar lain.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Ukuran file maksimal 20 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with open_image(io.BytesIO(data)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Format gambar harus JPG, PNG, atau WebP.")
                if source.width * source.height > MAX_IMAGE_PIXELS:
                    raise ValueError("Resolusi maksimal 24 megapiksel. Perkecil gambar terlebih dahulu.")
                source.load()
                normalized = ImageOps.exif_transpose(source)
                if normalized.mode in {"RGBA", "LA"} or "transparency" in normalized.info:
                    rgba = normalized.convert("RGBA")
                    background = Image.new("RGB", rgba.size, "white")
                    background.paste(rgba, mask=rgba.getchannel("A"))
                    return background
                return normalized.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        raise ValueError("Gambar tidak dapat dibaca. Unggah ulang sebagai JPG, PNG, atau WebP.") from error


def detection_rows(result: Any) -> list[dict]:
    """Convert Ultralytics xyxy boxes into stable, unrounded confidence values."""
    if result.boxes is None or len(result.boxes) == 0:
        return []
    rows = []
    for index, box in enumerate(result.boxes.data.cpu().tolist(), start=1):
        x1, y1, x2, y2, confidence, class_id = box[:6]
        name = result.names[int(class_id)]
        if name not in LABELS:
            raise ValueError(f"Kelas model tidak sesuai untuk demo kursi: {name}.")
        rows.append({
            "id": index, "kelas": name, "status": LABELS[name],
            "confidence": float(confidence),
            "x1": round(x1, 1), "y1": round(y1, 1),
            "x2": round(x2, 1), "y2": round(y2, 1),
        })
    return rows


def summarize(rows: list[dict]) -> dict:
    empty = sum(row["kelas"] == "EmptyChair" for row in rows)
    occupied = sum(row["kelas"] == "OccupiedChair" for row in rows)
    total = empty + occupied
    return {"empty": empty, "occupied": occupied, "total": total,
            "occupancy": occupied / total if total else None}


def annotate(image: Image.Image, rows: list[dict], show_confidence: bool) -> Image.Image:
    annotated = image.copy()
    draw = ImageDraw.Draw(annotated)
    line_width = max(2, round(max(image.size) / 400))
    font = ImageFont.load_default(size=max(12, round(max(image.size) / 65)))
    for row in rows:
        color = COLORS[row["kelas"]]
        x1, y1 = max(0, row["x1"]), max(0, row["y1"])
        x2, y2 = min(image.width - 1, row["x2"]), min(image.height - 1, row["y2"])
        draw.rectangle((x1, y1, max(x1, x2), max(y1, y2)), outline=color, width=line_width)
        label = row["status"]
        if show_confidence:
            label += f" {row['confidence']:.0%}"
        bounds = draw.textbbox((0, 0), label, font=font)
        label_width = bounds[2] - bounds[0] + 10
        label_height = bounds[3] - bounds[1] + 10
        left = max(0, min(x1, image.width - label_width))
        top = max(0, y1 - label_height)
        draw.rectangle((left, top, left + label_width, top + label_height), fill=color)
        draw.text((left + 5, top + 5 - bounds[1]), label, fill="white", font=font)
    return annotated


def predict(model: Any, lock: Any, image: Image.Image, confidence: float,
            image_size: int, device: str, show_confidence: bool) -> dict:
    started = perf_counter()
    # ponytail: one cached predictor; serialize requests for a local demo.
    with lock:
        result = model.predict(source=image, conf=confidence, imgsz=image_size,
                               device=device, verbose=False, save=False)[0]
        rows = detection_rows(result)
    elapsed = perf_counter() - started
    return {"rows": rows, "summary": summarize(rows),
            "annotated": annotate(image, rows, show_confidence),
            "elapsed_seconds": elapsed,
            "device": str(model.device)}


def image_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def csv_bytes(rows: list[dict]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8-sig")
