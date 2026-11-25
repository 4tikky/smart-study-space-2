import sqlite3

from fastapi import APIRouter, HTTPException, Response

from backend.database import store
from backend.schemas import CameraInput, FloorInput, SettingsInput, TrainingMetadata, ZoneInput
from backend.services.model import model
from backend.services.monitoring import current_occupancy, registry

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    with store.connection() as db:
        db.execute("SELECT 1")
    return {"status": "online", "model": model.status}


@router.get("/model/info")
def model_info():
    return {**model.info(), "metadata": store.metadata()}


@router.put("/model/metadata")
def update_metadata(body: TrainingMetadata):
    return store.set_preference("metadata", body.model_dump())


@router.get("/occupancy")
def occupancy(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return current_occupancy()


@router.get("/operator/monitoring")
def operator_monitoring(response: Response):
    response.headers["Cache-Control"] = "no-store"
    data = current_occupancy(include_preview=True)
    latest = store.history_rows(limit=1)[0]
    return {**data, "last_detection": latest[0] if latest else None}


@router.get("/floors")
def floors():
    return current_occupancy()["floors"]


@router.get("/configuration")
def configuration():
    return {"floors": store.records("floors", "ORDER BY id"), "zones": store.records("zones", "ORDER BY id"),
            "cameras": cameras(), "settings": store.settings()}


@router.get("/cameras")
def cameras():
    active = registry.snapshot()
    return [{**{k: v for k, v in row.items() if k != "stream_url"}, "busy": row["id"] in active}
            for row in store.records("cameras", "ORDER BY id")]


@router.get("/settings")
def settings():
    return store.settings()


@router.put("/settings")
def update_settings(body: SettingsInput):
    result = store.set_preference("settings", body.model_dump())
    store.prune()
    return result


def save_entity(table, body, key):
    data = body.model_dump()
    try:
        with store.connection() as db:
            if table == "cameras":
                if key and body.kind == "stream" and body.stream_url == "":
                    existing = db.execute("SELECT stream_url FROM cameras WHERE id=?", (key,)).fetchone()
                    if existing and existing["stream_url"]:
                        data["stream_url"] = existing["stream_url"]
                    elif existing:
                        raise HTTPException(422, "Masukkan URL stream.")
                if body.zone_id:
                    zone = db.execute("SELECT floor_id FROM zones WHERE id=?", (body.zone_id,)).fetchone()
                    if not zone or zone["floor_id"] != body.floor_id:
                        raise HTTPException(422, "Zona harus berada di lantai yang dipilih.")
            if table == "zones" and key:
                mismatch = db.execute("SELECT id FROM cameras WHERE zone_id=? AND floor_id!=?", (key, body.floor_id)).fetchone()
                if mismatch:
                    raise HTTPException(409, "Pindahkan kamera dari zona ini sebelum mengganti lantainya.")
            columns = ", ".join(data)
            if key is None:
                values = ", ".join("?" for _ in data)
                key = db.execute(f"INSERT INTO {table} ({columns}) VALUES ({values})", tuple(data.values())).lastrowid
            else:
                assignment = ", ".join(f"{field}=?" for field in data)
                if not db.execute(f"UPDATE {table} SET {assignment} WHERE id=?", (*data.values(), key)).rowcount:
                    raise HTTPException(404, "Konfigurasi tidak ditemukan.")
    except sqlite3.IntegrityError as exc:
        if "FOREIGN KEY" in str(exc):
            raise HTTPException(422, "Lantai atau zona tidak ditemukan.") from exc
        raise HTTPException(409, "Nama, posisi zona, atau cakupan kamera aktif sudah digunakan.") from exc
    if table == "cameras":
        registry.invalidate(key)
    if table == "floors" and not body.enabled:
        for cam in store.records("cameras", "WHERE floor_id=?", (key,)):
            registry.invalidate(cam["id"])
    data.pop("stream_url", None)
    return {"id": key, **data}


def delete_entity(table, key):
    try:
        with store.connection() as db:
            camera_ids = (
                [row[0] for row in db.execute("SELECT id FROM cameras WHERE floor_id=?", (key,))]
                if table == "floors" else [key] if table == "cameras" else []
            )
            if table == "floors":
                db.execute("DELETE FROM cameras WHERE floor_id=?", (key,))
            if not db.execute(f"DELETE FROM {table} WHERE id=?", (key,)).rowcount:
                raise HTTPException(404, "Konfigurasi tidak ditemukan.")
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "Pindahkan atau hapus kamera di zona ini terlebih dahulu.") from exc
    for camera_id in camera_ids:
        registry.invalidate(camera_id)
    return Response(status_code=204)


@router.post("/floors", status_code=201)
def create_floor(body: FloorInput):
    return save_entity("floors", body, None)


@router.put("/floors/{key}")
def update_floor(key: int, body: FloorInput):
    return save_entity("floors", body, key)


@router.delete("/floors/{key}", status_code=204)
def delete_floor(key: int):
    return delete_entity("floors", key)


@router.post("/zones", status_code=201)
def create_zone(body: ZoneInput):
    return save_entity("zones", body, None)


@router.put("/zones/{key}")
def update_zone(key: int, body: ZoneInput):
    return save_entity("zones", body, key)


@router.delete("/zones/{key}", status_code=204)
def delete_zone(key: int):
    return delete_entity("zones", key)


@router.post("/cameras", status_code=201)
def create_camera(body: CameraInput):
    if body.kind == "stream" and not body.stream_url:
        raise HTTPException(422, "Masukkan URL stream.")
    return save_entity("cameras", body, None)


@router.put("/cameras/{key}")
def update_camera(key: int, body: CameraInput):
    return save_entity("cameras", body, key)


@router.delete("/cameras/{key}", status_code=204)
def delete_camera(key: int):
    return delete_entity("cameras", key)
