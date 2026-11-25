import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
DATA_DIR = Path(os.getenv("SSS_DATA_DIR", str(ROOT / "backend" / "data"))).resolve()
DATABASE = DATA_DIR / "study-space.sqlite3"
TEMP_DIR = DATA_DIR / "video-jobs"
DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
ORIGINS = [value.strip() for value in os.getenv("SSS_ORIGINS", DEFAULT_ORIGINS).split(",") if value.strip()]
MAX_VIDEO_BYTES = 150 * 1024 * 1024
MAX_VIDEO_SECONDS = 600
MAX_FRAME_PIXELS = 1920 * 1080
MAX_WS_BYTES = 2 * 1024 * 1024
LIBRARY_TIMEZONE = "Asia/Jakarta"

# Keep Ultralytics preferences local to the project on Windows and Linux.
os.environ.setdefault("YOLO_CONFIG_DIR", str(DATA_DIR / "ultralytics"))
os.environ.setdefault("MPLCONFIGDIR", str(DATA_DIR / "matplotlib"))
os.environ.setdefault("YOLO_AUTOINSTALL", "false")
