import logging
import math
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from pathlib import Path
from threading import Event, Lock
from time import time
from uuid import uuid4

import cv2
import imageio_ffmpeg
from PIL import Image

from backend.config import MAX_VIDEO_DIMENSION, MAX_VIDEO_FRAME_PIXELS, MAX_VIDEO_SECONDS, TEMP_DIR
from backend.database import store
from backend.services.model import ModelUnavailable, annotate, model

log = logging.getLogger(__name__)
TTL_SECONDS = 60 * 60
JOB_FILE = re.compile(r"[0-9a-f]{32}\.(?:mp4|input\.(?:mp4|avi|mov))")


def processing_size(width, height):
    """Fit inside the orientation's processing bounds without upscaling.

    Whole-pixel rounding changes the aspect ratio by at most one pixel. The
    encoder pads an odd edge by one pixel instead of stretching the image.
    """
    max_width, max_height = (1920, 1080) if width >= height else (1080, 1920)
    scale = min(1, max_width / width, max_height / height)
    return max(1, math.floor(width * scale)), max(1, math.floor(height * scale))


def video_metadata(fps, count, width, height):
    target_width, target_height = processing_size(width, height)
    return {
        "width": width, "height": height, "fps": fps,
        "duration_seconds": count / fps,
        "orientation": "landscape" if width >= height else "portrait",
        "processing_width": target_width, "processing_height": target_height,
        "resized": (width, height) != (target_width, target_height),
    }


def inspect_video(path):
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise ValueError("Video tidak dapat dibuka. Gunakan MP4, AVI, atau MOV dengan codec yang didukung.")
        fps = capture.get(cv2.CAP_PROP_FPS)
        count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        width = capture.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = capture.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not all(math.isfinite(n) and n > 0 for n in (fps, count, width, height)) or fps > 240:
            raise ValueError("Metadata frame video tidak dapat dibaca.")
        if width * height > MAX_VIDEO_FRAME_PIXELS or max(width, height) > MAX_VIDEO_DIMENSION:
            raise ValueError("Resolusi video melebihi batas keamanan: maksimal 16.777.216 piksel per frame dan 8.192 piksel per sisi.")
        if count / fps > MAX_VIDEO_SECONDS:
            raise ValueError("Durasi video maksimal 10 menit.")
        return capture, fps, round(count), round(width), round(height)
    except BaseException:
        capture.release()
        raise


class VideoJobs:
    def __init__(self):
        self.lock = Lock()
        self.jobs = {}
        self.closing = Event()
        self.pool = None

    def start(self):
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        self.clean_files()
        self.jobs.clear()
        self.closing.clear()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="video")

    def stop(self):
        self.closing.set()
        self.pool.shutdown(wait=True, cancel_futures=True)
        self.clean_files()

    def clean_files(self):
        for path in TEMP_DIR.iterdir():
            if path.is_file() and JOB_FILE.fullmatch(path.name):
                path.unlink()

    def cleanup(self):
        threshold = time() - TTL_SECONDS
        with self.lock:
            expired = [key for key, job in self.jobs.items() if job.get("finished", threshold + 1) < threshold]
            for key in expired:
                self.output(key).unlink(missing_ok=True)
                del self.jobs[key]

    def reserve(self):
        self.cleanup()
        with self.lock:
            count = sum(job["status"] in {"uploading", "queued", "processing"} for job in self.jobs.values())
            if count >= 3:
                return None
            key = uuid4().hex
            self.jobs[key] = {"id": key, "status": "uploading", "progress": 0, "frames": []}
            return key

    def discard(self, key):
        with self.lock:
            self.jobs.pop(key, None)

    def submit(self, key, path, stride, options):
        self.update(key, status="queued")
        self.pool.submit(self.process, key, path, stride, options)

    def update(self, key, **fields):
        with self.lock:
            self.jobs[key].update(fields)

    def get(self, key):
        with self.lock:
            item = self.jobs.get(key)
            return item.copy() if item else None

    def output(self, key):
        return TEMP_DIR / f"{key}.mp4"

    def process(self, key: str, path: Path, stride: int, options):
        capture = encoder = None
        output = self.output(key)
        try:
            self.update(key, status="processing")
            capture, fps, count, width, height = inspect_video(path)
            metadata = video_metadata(fps, count, width, height)
            target_width, target_height = metadata["processing_width"], metadata["processing_height"]
            self.update(key, metadata=metadata)
            # Sample at most 1,200 frames per job. Play at the sampled cadence.
            stride = max(stride, math.ceil(count / 1200))
            encoder = subprocess.Popen([
                imageio_ffmpeg.get_ffmpeg_exe(), "-nostats", "-loglevel", "error", "-y", "-f", "rawvideo",
                "-pix_fmt", "rgb24", "-s", f"{target_width}x{target_height}", "-r", str(fps / stride), "-i", "-",
                "-an", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
            ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            points = []
            index = 0
            while index < min(count, int(fps * MAX_VIDEO_SECONDS)) and capture.grab():
                if self.closing.is_set():
                    raise ValueError("Pemrosesan dihentikan karena layanan ditutup.")
                if index % stride == 0:
                    ok, bgr = capture.retrieve()
                    if not ok or bgr.shape[:2] != (height, width):
                        raise ValueError("Frame video rusak atau resolusinya berubah saat diproses.")
                    if metadata["resized"]:
                        bgr = cv2.resize(bgr, (target_width, target_height), interpolation=cv2.INTER_AREA)
                    image = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
                    result = model.predict(image, options)
                    encoder.stdin.write(annotate(image, result["rows"]).tobytes())
                    playback_seconds = round(index / fps, 3)
                    source_seconds = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
                    if not math.isfinite(source_seconds) or source_seconds < 0 or (points and source_seconds <= points[-1]["seconds"]):
                        source_seconds = playback_seconds
                    points.append({"frame": index + 1, "seconds": round(source_seconds, 3),
                                   "playback_seconds": playback_seconds, **result["summary"],
                                   "elapsed_ms": result["elapsed_ms"]})
                    self.update(key, progress=min(99, round((index + 1) / count * 100)),
                                processed_frames=len(points), latest=points[-1])
                index += 1
            if index < count:
                raise ValueError("Video terpotong atau memiliki frame yang tidak dapat dibaca. Coba unggah ulang video yang utuh.")
            encoder.stdin.close()
            if encoder.wait(timeout=60) or not points:
                raise ValueError("Video hasil tidak dapat dikodekan atau video tidak memiliki frame yang dapat dibaca.")
            last = points[-1]
            store.record_detection(key, "video", {k: last[k] for k in ("total", "empty", "occupied", "occupancy")},
                                   sum(item["elapsed_ms"] for item in points), details={
                                       "sampled_frames": len(points), "sample_every": stride,
                                       "duration_seconds": round(index / fps, 3), "last_frame": last,
                                       "video_metadata": metadata,
                                   })
            self.update(key, status="completed", progress=100, frames=points, sample_every=stride,
                        fps=fps, duration=round(index / fps, 3), finished=time())
        except (ValueError, ModelUnavailable) as exc:
            self.update(key, status="error", error=str(exc), finished=time())
        except Exception:
            log.exception("Pemrosesan video gagal")
            self.update(key, status="error", error="Video gagal diproses. Pastikan file tidak rusak dan gunakan codec MP4, AVI, atau MOV yang didukung.", finished=time())
        finally:
            if capture is not None:
                capture.release()
            if encoder and encoder.poll() is None:
                encoder.kill()
                encoder.wait()
            if encoder and encoder.stdin:
                with suppress(OSError):
                    encoder.stdin.close()
            if self.get(key)["status"] == "error":
                output.unlink(missing_ok=True)
            path.unlink(missing_ok=True)


jobs = VideoJobs()
