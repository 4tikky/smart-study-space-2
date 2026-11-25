from collections import deque
from threading import Lock
from time import monotonic

from backend.database import store
from inference import summarize


class LiveRegistry:
    """Frames are held in memory only while a camera session is connected."""

    def __init__(self):
        self.lock = Lock()
        self.active = {}

    def claim(self, camera_id, session_id):
        with self.lock:
            if camera_id in self.active:
                return False
            self.active[camera_id] = {"session_id": session_id}
            return True

    def release(self, camera_id, session_id):
        with self.lock:
            if self.active.get(camera_id, {}).get("session_id") == session_id:
                del self.active[camera_id]

    def update(self, camera, session_id, summary, preview):
        with self.lock:
            current = self.active.get(camera["id"], {})
            if current.get("session_id") == session_id:
                current.update(summary=summary, preview=preview, timestamp=store.now(),
                               fresh_until=monotonic() + max(10, 4 * camera["interval_ms"] / 1000))

    def snapshot(self):
        with self.lock:
            return {key: value.copy() for key, value in self.active.items()}

    def invalidate(self, camera_id):
        with self.lock:
            self.active.pop(camera_id, None)


registry = LiveRegistry()


def aggregate(summaries):
    if not summaries:
        return None
    total = sum(s["total"] for s in summaries)
    empty = sum(s["empty"] for s in summaries)
    occupied = sum(s["occupied"] for s in summaries)
    return {"total": total, "empty": empty, "occupied": occupied,
            "occupancy": occupied / total if total else None}


def availability(summary, settings):
    if not summary or summary["occupancy"] is None:
        return "unavailable"
    percent = summary["occupancy"] * 100
    if percent >= settings["full_at"]:
        return "full"
    if percent >= settings["limited_at"]:
        return "limited"
    return "plenty"


def current_occupancy(include_preview=False):
    snapshot = registry.snapshot()
    settings = store.settings()
    floors = store.records("floors", "WHERE enabled=1 ORDER BY id")
    zones = store.records("zones", "ORDER BY id")
    cameras = store.records("cameras", "WHERE enabled=1")
    instant = monotonic()
    all_reports = []
    active_sources = 0
    preview = None
    for floor in floors:
        reports = {}
        states = {}
        for cam in cameras:
            if cam["floor_id"] != floor["id"]:
                continue
            item = snapshot.get(cam["id"], {})
            fresh = item.get("fresh_until", 0) >= instant
            states[cam["zone_id"]] = "online" if fresh else "offline"
            if fresh:
                active_sources += 1
                reports[cam["zone_id"]] = item
                if include_preview and (not preview or item["timestamp"] > preview["timestamp"]):
                    preview = {"name": cam["name"], "timestamp": item["timestamp"], "image": item["preview"]}
        # When configured for zones, every floor total uses only zone-scoped cameras.
        has_scoped_sources = any(key is not None for key in states)
        contributing = [report for key, report in reports.items() if key is not None or not has_scoped_sources]
        summary = aggregate([report["summary"] for report in contributing])
        floor.update(
            summary=summary, status=availability(summary, settings),
            connection="online" if contributing else ("offline" if states else "unconfigured"),
            last_updated=max((report["timestamp"] for report in contributing), default=None),
            zones=[{
                **zone, "summary": reports.get(zone["id"], {}).get("summary"),
                "connection": states.get(zone["id"], "unconfigured"),
                "last_updated": reports.get(zone["id"], {}).get("timestamp"),
            } for zone in zones if zone["floor_id"] == floor["id"]],
            active_sources=len(reports), configured_sources=len(states),
            reporting_scopes=len(contributing),
            configured_scopes=sum(key is not None for key in states) or len(states),
        )
        if summary is not None:
            all_reports.append(summary)
    summary = aggregate(all_reports)
    return {"summary": summary, "status": availability(summary, settings), "floors": floors,
            "last_updated": max((f["last_updated"] for f in floors if f["last_updated"]), default=None),
            "active_sources": active_sources, "monitored_floors": len(all_reports),
            **({"preview": preview} if include_preview else {})}


def iou(first, second):
    x = max(0, min(first["x2"], second["x2"]) - max(first["x1"], second["x1"]))
    y = max(0, min(first["y2"], second["y2"]) - max(first["y1"], second["y1"]))
    intersection = x * y
    area = sum(max(0, box["x2"] - box["x1"]) * max(0, box["y2"] - box["y1"]) for box in (first, second))
    return intersection / (area - intersection) if area > intersection else 0


class SessionTracker:
    """Greedy overlap matching with a short occlusion window, scoped to one stream session."""

    def __init__(self):
        self.tracks = {}
        self.next_id = 1
        self.frame = 0
        self.observations = deque(maxlen=3)

    def update(self, rows):
        self.frame += 1
        self.tracks = {key: item for key, item in self.tracks.items() if self.frame - item[0] <= 3}
        candidates = sorted(
            ((iou(row, old), index, key) for index, row in enumerate(rows)
             for key, (_, old) in self.tracks.items()), reverse=True,
        )
        used = set()
        for score, index, key in candidates:
            if score < 0.3:
                break
            if key not in used and "track_id" not in rows[index]:
                rows[index]["track_id"] = key
                used.add(key)
        for row in rows:
            if "track_id" not in row:
                row["track_id"] = self.next_id
                self.next_id += 1
            self.tracks[row["track_id"]] = (self.frame, row)
        self.observations.appendleft(summarize(rows))
        # Choose an observed frame by median occupied count, then total. Never blend counts.
        ordered = sorted(self.observations, key=lambda s: (s["occupied"], s["total"]))
        return ordered[len(ordered) // 2] if len(ordered) == 3 else self.observations[0]
