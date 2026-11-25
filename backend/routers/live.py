import asyncio
import logging
from contextlib import suppress
from threading import Condition, Event, Thread
from time import monotonic
from uuid import uuid4

import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from PIL import Image
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from backend.config import MAX_WS_BYTES, ORIGINS
from backend.database import store
from backend.schemas import LiveOptions
from backend.services.model import ModelUnavailable, annotate, data_url, model
from backend.services.monitoring import SessionTracker, registry
from inference import read_image

router = APIRouter()
log = logging.getLogger(__name__)


class CameraStream:
    """Continuously drain the source so inference always samples the newest frame."""

    def __init__(self, url):
        capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 4000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 4000,
        ])
        if not capture.isOpened():
            capture.release()
            raise ValueError("Stream kamera gagal dibuka. Periksa URL, izin, dan jaringan.")
        self.capture = capture
        self.stopped = Event()
        self.condition = Condition()
        self.latest = None
        self.sequence = 0
        self.last_read = 0
        self.reader = Thread(target=self._read_frames, name="camera-reader", daemon=True)
        self.reader.start()

    def _read_frames(self):
        try:
            while not self.stopped.is_set():
                ok, frame = self.capture.read()
                if not ok:
                    break
                with self.condition:
                    self.latest = frame
                    self.sequence += 1
                    self.condition.notify_all()
        finally:
            self.stopped.set()
            with self.condition:
                self.condition.notify_all()
            self.capture.release()

    def read(self):
        with self.condition:
            changed = self.condition.wait_for(
                lambda: self.sequence > self.last_read or self.stopped.is_set(), timeout=5,
            )
            if not changed or self.stopped.is_set():
                raise ValueError("Aliran kamera terputus atau berhenti mengirim frame.")
            frame = self.latest
            self.last_read = self.sequence
        height, width = frame.shape[:2]
        if max(height, width) > 960:
            scale = 960 / max(height, width)
            frame = cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))),
                               interpolation=cv2.INTER_AREA)
        return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

    def close(self):
        self.stopped.set()
        with self.condition:
            self.condition.notify_all()
        self.reader.join(timeout=5)


async def watch_disconnect(websocket, stop):
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect" or message.get("text") == "stop":
            stop.set()
            return


@router.websocket("/ws/live-detection")
async def live_detection(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    own_host = websocket.headers.get("host", "")
    if origin and origin not in {*ORIGINS, f"http://{own_host}", f"https://{own_host}"}:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    session_id = uuid4().hex
    tracker = SessionTracker()
    camera = capture = watcher = last = None
    claimed = False
    last_saved = 0
    previous = None
    try:
        options = LiveOptions.model_validate(await asyncio.wait_for(websocket.receive_json(), timeout=15))
        if model.status != "ready":
            raise ModelUnavailable("Model belum siap. Periksa halaman Informasi Model.")
        interval = options.interval_ms / 1000
        if options.camera_id:
            camera = await run_in_threadpool(store.camera, options.camera_id)
            floor = await run_in_threadpool(store.records, "floors", "WHERE id=? AND enabled=1",
                                            (camera["floor_id"],)) if camera else []
            if not (camera and camera["enabled"] and floor):
                raise ValueError("Sumber kamera belum aktif atau tidak ditemukan.")
            claimed = registry.claim(camera["id"], session_id)
            if not claimed:
                raise ValueError("Kamera ini sedang digunakan sesi lain.")
            camera["interval_ms"] = options.interval_ms
        stream = camera and camera["kind"] == "stream"
        stop = asyncio.Event()
        if stream:
            watcher = asyncio.create_task(watch_disconnect(websocket, stop))
            capture = await run_in_threadpool(CameraStream, camera["stream_url"])
            if stop.is_set():
                return
        await websocket.send_json({"type": "ready", "session_id": session_id})
        while True:
            if camera and registry.snapshot().get(camera["id"], {}).get("session_id") != session_id:
                raise ValueError("Konfigurasi kamera berubah. Mulai sesi baru.")
            started = monotonic()
            if stream:
                if stop.is_set():
                    break
                image = await run_in_threadpool(capture.read)
                if stop.is_set():
                    break
            else:
                message = await asyncio.wait_for(websocket.receive(), timeout=max(20, interval * 3))
                if message["type"] == "websocket.disconnect" or message.get("text") == "stop":
                    break
                content = message.get("bytes")
                if not content or len(content) > MAX_WS_BYTES:
                    raise ValueError("Frame kamera tidak valid atau melebihi 2 MB.")
                if previous is not None and monotonic() - previous < interval:
                    await asyncio.sleep(interval - (monotonic() - previous))
                image = await run_in_threadpool(read_image, content)
                if image.width * image.height > 2_073_600:
                    raise ValueError("Resolusi frame kamera terlalu besar.")
                started = monotonic()
            result = await run_in_threadpool(model.predict, image, options)
            smoothed = tracker.update(result["rows"])
            timestamp = store.now()
            last = (smoothed, result["elapsed_ms"])
            if previous is None or started - last_saved >= 10:
                await run_in_threadpool(store.record_detection, session_id, "live", *last, camera)
                last_saved = started
            if camera:
                preview = await run_in_threadpool(lambda: data_url(annotate(image, result["rows"])))
                registry.update(camera, session_id, smoothed, preview)
            output = {
                "type": "frame", **result, "smoothed": smoothed, "timestamp": timestamp,
                "fps": round(1 / (started - previous), 2) if previous and started > previous else None,
            }
            if stream:
                output["image"] = await run_in_threadpool(data_url, image)
            await websocket.send_json(output)
            previous = started
            if stream:
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=max(0.001, interval - (monotonic() - started)))
    except WebSocketDisconnect:
        pass
    except (ValueError, ValidationError, ModelUnavailable, asyncio.TimeoutError) as exc:
        if isinstance(exc, asyncio.TimeoutError):
            message = "Kamera tidak mengirim frame. Periksa koneksi dan izin."
        elif isinstance(exc, ValidationError):
            message = "Pengaturan inferensi kamera tidak valid."
        else:
            message = str(exc)
        with suppress(RuntimeError, WebSocketDisconnect):
            await websocket.send_json({"type": "error", "message": message})
    except Exception:
        log.exception("Pemantauan live gagal")
        with suppress(RuntimeError, WebSocketDisconnect):
            await websocket.send_json({"type": "error", "message": "Pemantauan terputus. Coba mulai lagi."})
    finally:
        if claimed:
            registry.release(camera["id"], session_id)
        if watcher is not None:
            watcher.cancel()
            with suppress(asyncio.CancelledError, RuntimeError):
                await watcher
        if capture is not None:
            await run_in_threadpool(capture.close)
        if last and previous and previous - last_saved > 1:
            await run_in_threadpool(store.record_detection, session_id, "live", *last, camera)
        with suppress(RuntimeError, WebSocketDisconnect):
            await websocket.close()
