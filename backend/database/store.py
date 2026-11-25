import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from backend.config import DATABASE
from backend.schemas import SettingsInput, TrainingMetadata


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@contextmanager
def connection():
    db = sqlite3.connect(DATABASE, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with connection() as db:
        db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS floors (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL, enabled INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS zones (
                id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
                name TEXT NOT NULL, description TEXT NOT NULL, outlets INTEGER,
                layout_row INTEGER, layout_col INTEGER,
                UNIQUE(floor_id, name), UNIQUE(floor_id, layout_row, layout_col)
            );
            CREATE TABLE IF NOT EXISTS cameras (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
                floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
                zone_id INTEGER REFERENCES zones(id) ON DELETE RESTRICT, stream_url TEXT NOT NULL,
                enabled INTEGER NOT NULL, interval_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, timestamp TEXT NOT NULL,
                source TEXT NOT NULL, floor_id INTEGER, floor_name TEXT, zone_name TEXT,
                camera_id INTEGER, camera_name TEXT, total INTEGER NOT NULL, empty INTEGER NOT NULL,
                occupied INTEGER NOT NULL, occupancy REAL, elapsed_ms REAL NOT NULL, details TEXT
            );
            CREATE INDEX IF NOT EXISTS history_time ON history(timestamp);
            CREATE INDEX IF NOT EXISTS history_floor_time ON history(floor_id, timestamp);
            CREATE UNIQUE INDEX IF NOT EXISTS one_camera_per_scope
              ON cameras(floor_id, COALESCE(zone_id, 0)) WHERE enabled = 1;
        """)
        if not get_preference("initialized", False, db):
            db.executemany(
                "INSERT INTO floors(name,description,enabled) VALUES (?,?,1)",
                [("Lantai 1", ""), ("Lantai 2", ""), ("Lantai 3", "")],
            )
            set_preference("initialized", True, db)
    prune()


def get_preference(key, default, db=None):
    if db is None:
        with connection() as db:
            return get_preference(key, default, db)
    row = db.execute("SELECT value FROM preferences WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def set_preference(key, value, db=None):
    if db is None:
        with connection() as db:
            return set_preference(key, value, db)
    db.execute("INSERT OR REPLACE INTO preferences VALUES (?,?)", (key, json.dumps(value)))
    return value


def settings():
    return get_preference("settings", SettingsInput().model_dump())


def metadata():
    return get_preference("metadata", TrainingMetadata().model_dump())


def prune():
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings()["retention_days"])
    with connection() as db:
        db.execute("DELETE FROM history WHERE timestamp < ?", (cutoff.isoformat(),))


def records(table, where="", args=()):
    # Table and clause names only come from internal callers.
    with connection() as db:
        return [dict(row) for row in db.execute(f"SELECT * FROM {table} {where}", args)]


def camera(camera_id):
    rows = records("cameras", "WHERE id=?", (camera_id,))
    return rows[0] if rows else None


def record_detection(session_id, source, summary, elapsed_ms, camera=None, details=None):
    floor = zone = None
    with connection() as db:
        if camera:
            floor = db.execute("SELECT name FROM floors WHERE id=?", (camera["floor_id"],)).fetchone()
            zone = db.execute("SELECT name FROM zones WHERE id=?", (camera["zone_id"],)).fetchone()
        row = {
            "session_id": session_id, "timestamp": now(), "source": source,
            "floor_id": camera["floor_id"] if camera else None,
            "floor_name": floor["name"] if floor else None, "zone_name": zone["name"] if zone else None,
            "camera_id": camera["id"] if camera else None, "camera_name": camera["name"] if camera else None,
            **summary, "elapsed_ms": elapsed_ms, "details": json.dumps(details) if details is not None else None,
        }
        keys = ", ".join(row)
        values = ", ".join("?" for _ in row)
        cursor = db.execute(f"INSERT INTO history ({keys}) VALUES ({values})", tuple(row.values()))
        return cursor.lastrowid


def history_rows(conditions=(), values=(), limit=None, offset=0):
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    suffix = "LIMIT ? OFFSET ?" if limit is not None else ""
    args = (*values, limit, offset) if limit is not None else values
    columns = ("id, session_id, timestamp, source, floor_id, floor_name, zone_name, "
               "camera_id, camera_name, total, empty, occupied, occupancy, elapsed_ms")
    with connection() as db:
        count = db.execute(f"SELECT COUNT(*) FROM history {where}", values).fetchone()[0]
        rows = db.execute(f"SELECT {columns} FROM history {where} ORDER BY timestamp DESC, id DESC {suffix}", args)
        return [dict(row) for row in rows], count
