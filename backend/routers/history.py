import csv
import io
import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from backend.config import LIBRARY_TIMEZONE
from backend.database import store

router = APIRouter(prefix="/api")
WIB = ZoneInfo(LIBRARY_TIMEZONE)


def filters(start: date | None = None, end: date | None = None,
            source: Literal["image", "video", "live"] | None = None,
            floor: int | None = None, camera: int | None = None, q: Annotated[str, Query(max_length=100)] = ""):
    clauses = []
    values = []
    if start and end and start > end:
        raise HTTPException(422, "Tanggal awal harus sebelum tanggal akhir.")
    if start:
        clauses.append("timestamp >= ?")
        values.append(datetime.combine(start, time.min, WIB).astimezone(timezone.utc).isoformat())
    if end:
        clauses.append("timestamp <= ?")
        values.append(datetime.combine(end, time.max, WIB).astimezone(timezone.utc).isoformat())
    for column, value in (("source", source), ("floor_id", floor), ("camera_id", camera)):
        if value is not None:
            clauses.append(f"{column} = ?")
            values.append(value)
    if q.strip():
        clauses.append("(session_id LIKE ? OR floor_name LIKE ? OR zone_name LIKE ? OR camera_name LIKE ?)")
        values.extend([f"%{q.strip()}%"] * 4)
    return clauses, values


@router.get("/history")
def history(criteria=Depends(filters), limit: int = Query(30, ge=1, le=200), offset: int = Query(0, ge=0)):
    rows, count = store.history_rows(*criteria, limit=limit, offset=offset)
    return {"items": rows, "count": count}


@router.get("/history/export")
def export(criteria=Depends(filters)):
    rows, _ = store.history_rows(*criteria)
    columns = ["id", "session_id", "timestamp", "source", "floor_id", "floor_name", "zone_name",
               "camera_id", "camera_name", "total", "empty", "occupied", "occupancy", "elapsed_ms"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, columns)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: "'" + val if isinstance(val, str) and val.lstrip().startswith(("=", "+", "-", "@")) else val
                         for key, val in row.items()})
    return Response(output.getvalue().encode("utf-8-sig"), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="study-space-history.csv"'})


@router.get("/history/{key}")
def detail(key: int):
    rows = store.records("history", "WHERE id=?", (key,))
    if not rows:
        raise HTTPException(404, "Catatan deteksi tidak ditemukan.")
    row = rows[0]
    return {**row, "details": json.loads(row["details"]) if row["details"] else None}


def grouped(rows, key):
    groups = {}
    for row in rows:
        label = key(row)
        item = groups.setdefault(label, {"label": label, "samples": 0, "empty_total": 0,
                                         "occupancy_total": 0.0, "with_occupancy": 0})
        item["samples"] += 1
        item["empty_total"] += row["empty"]
        if row["occupancy"] is not None:
            item["occupancy_total"] += row["occupancy"]
            item["with_occupancy"] += 1
    return [{"label": item["label"], "samples": item["samples"],
             "empty": round(item["empty_total"] / item["samples"], 2),
             "occupancy": round(item["occupancy_total"] / item["with_occupancy"] * 100, 2)
             if item["with_occupancy"] else None}
            for item in sorted(groups.values(), key=lambda item: item["label"])]


@router.get("/analytics")
def analytics(start: date | None = None, end: date | None = None):
    end = end or datetime.now(WIB).date()
    start = start or end - timedelta(days=6)
    criteria = filters(start=start, end=end, source="live")
    where, values = criteria
    where.append("camera_id IS NOT NULL")
    rows, _ = store.history_rows(where, values)
    for row in rows:
        row["local"] = datetime.fromisoformat(row["timestamp"]).astimezone(WIB)
    hourly = grouped(rows, lambda row: row["local"].strftime("%H:00"))
    populated = [item for item in hourly if item["occupancy"] is not None]
    period = "%Y-%m-%d %H:00" if start == end else "%Y-%m-%d"
    days = ["1 Sen", "2 Sel", "3 Rab", "4 Kam", "5 Jum", "6 Sab", "7 Min"]
    return {
        "count": len(rows),
        "average": grouped(rows, lambda _: "Semua")[-1]["occupancy"] if rows else None,
        "trend": grouped(rows, lambda row: row["local"].strftime(period)),
        "floors": grouped([row for row in rows if row["floor_name"]], lambda row: row["floor_name"]),
        "hourly": hourly,
        "daily": grouped(rows, lambda row: days[row["local"].weekday()]),
        "peak": max(populated, key=lambda row: row["occupancy"]) if populated else None,
    }
