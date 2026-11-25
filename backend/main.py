import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from backend.config import MAX_VIDEO_BYTES, ORIGINS
from backend.database import store
from backend.routers import configuration, detection, history, live
from backend.services.model import model
from backend.services.video import jobs
from inference import MAX_UPLOAD_BYTES

logging.basicConfig(level=logging.INFO)


async def cleanup():
    while True:
        await asyncio.sleep(300)
        await run_in_threadpool(store.prune)
        await run_in_threadpool(jobs.cleanup)


@asynccontextmanager
async def lifespan(app):
    store.initialize()
    jobs.start()
    model.start()
    task = asyncio.create_task(cleanup())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        await run_in_threadpool(jobs.stop)


app = FastAPI(title="Smart Study Space", version="1.0.0", lifespan=lifespan)

for router in (configuration.router, detection.router, history.router, live.router):
    app.include_router(router)


@app.middleware("http")
async def validate_size(request: Request, call_next):
    limits = {"/api/detect/image": MAX_UPLOAD_BYTES, "/api/detect/video": MAX_VIDEO_BYTES}
    if request.method == "POST" and request.url.path.rstrip("/") in limits:
        length = request.headers.get("content-length")
        if length is None or not length.isdecimal():
            return JSONResponse({"detail": "Panjang unggahan harus diketahui."}, status_code=411)
        if int(length) > limits[request.url.path.rstrip("/")] + 64 * 1024:
            return JSONResponse({"detail": "Ukuran file melebihi batas unggahan."}, status_code=413)
    return await call_next(request)


app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type"])
