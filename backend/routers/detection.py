import logging
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse

from backend.config import MAX_VIDEO_BYTES, TEMP_DIR
from backend.database import store
from backend.schemas import InferenceOptions
from backend.services.model import ModelUnavailable, annotate, data_url, model
from backend.services.video import inspect_video, jobs
from inference import MAX_UPLOAD_BYTES, read_image

router = APIRouter(prefix="/api")
log = logging.getLogger(__name__)


def inference_form(confidence: Annotated[float, Form(ge=0.05, le=0.95)] = 0.25,
                   resolution: Annotated[Literal["320", "480", "640", "800", "960"], Form()] = "640",
                   device: Annotated[Literal["cpu", "auto"], Form()] = "cpu"):
    return InferenceOptions(confidence=confidence, resolution=int(resolution), device=device)


@router.post("/detect/image")
def detect_image(response: Response, file: Annotated[UploadFile, File()],
                 options: Annotated[InferenceOptions, Depends(inference_form)]):
    response.headers["Cache-Control"] = "no-store"
    try:
        content = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Ukuran gambar maksimal 20 MB.")
        image = read_image(content)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        file.file.close()
    try:
        result = model.predict(image, options)
        session_id = uuid4().hex
        history_id = store.record_detection(session_id, "image", result["summary"], result["elapsed_ms"],
                                            details={k: result[k] for k in ("rows", "width", "height", "device")})
        return {**result, "session_id": session_id, "history_id": history_id,
                "annotated": data_url(annotate(image, result["rows"]), "PNG")}
    except ModelUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        log.exception("Deteksi gambar gagal")
        raise HTTPException(500, "Inferensi gambar gagal. Coba lagi.") from exc


@router.post("/detect/video", status_code=202)
def detect_video(file: Annotated[UploadFile, File()], options: Annotated[InferenceOptions, Depends(inference_form)],
                 sample_every: Annotated[int, Form(ge=1, le=120)] = 10):
    key = path = None
    submitted = False
    try:
        if model.status != "ready":
            raise HTTPException(503, "Model belum siap untuk pemrosesan video.")
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in {".mp4", ".avi", ".mov"}:
            raise HTTPException(422, "Format video harus MP4, AVI, atau MOV.")
        header = file.file.read(16)
        is_avi = header[:4] == b"RIFF" and header[8:12] == b"AVI "
        is_iso = header[4:8] in {b"ftyp", b"wide", b"mdat", b"moov", b"free"}
        if not (is_avi if suffix == ".avi" else is_iso):
            raise HTTPException(422, "Isi file tidak cocok dengan format video.")
        key = jobs.reserve()
        if not key:
            raise HTTPException(429, "Antrean video penuh. Coba lagi setelah proses selesai.")
        path = TEMP_DIR / f"{key}.input{suffix}"
        file.file.seek(0)
        size = 0
        with path.open("wb") as target:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_VIDEO_BYTES:
                    raise HTTPException(413, "Ukuran video maksimal 150 MB.")
                target.write(chunk)
        capture, *_ = inspect_video(path)
        capture.release()
        jobs.submit(key, path, sample_every, options)
        submitted = True
        return {"id": key, "status": "queued"}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        file.file.close()
        if not submitted:
            if path:
                path.unlink(missing_ok=True)
            if key:
                jobs.discard(key)


@router.get("/jobs/{job_id}")
def job_status(job_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    jobs.cleanup()
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job video tidak ditemukan atau sudah kedaluwarsa.")
    return {key: value for key, value in job.items() if key != "finished"}


@router.get("/jobs/{job_id}/video")
def job_video(job_id: str):
    jobs.cleanup()
    job = jobs.get(job_id)
    if not job or job["status"] != "completed":
        raise HTTPException(404, "Video belum tersedia atau sudah kedaluwarsa.")
    return FileResponse(jobs.output(job_id), media_type="video/mp4",
                        filename="smart-study-detection.mp4", content_disposition_type="inline",
                        headers={"Cache-Control": "no-store"})
