"""JalKavach web server: JSON API + the built web app (web/dist). Offline.

    uv run uvicorn app.server:app --port 8036
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from jalkavach.service import Service  # noqa: E402

app = FastAPI(title="JalKavach API", version="0.2.0")
svc = Service()


@app.middleware("http")
async def no_cache_html(request, call_next):
    resp = await call_next(request)
    if request.url.path == "/" or request.url.path.endswith(".html"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


class TextIn(BaseModel):
    text: str
    day: int = 9
    hour: int = 17
    add: bool = False


class TestIn(BaseModel):
    node: int
    day: int
    hour: int = 17
    failed: bool
    value: float | None = None


class ActionIn(BaseModel):
    actor: str
    day: int
    hour: int = 17


@app.get("/api/meta")
def meta():
    return svc.meta_info()


@app.get("/api/network")
def network():
    return svc.network()


@app.get("/api/day/{day}")
def day_state(day: int, hour: int = 17):
    return svc.day_state(day, hour)


@app.post("/api/reset")
def reset():
    return svc.reset()


@app.get("/api/clips")
def clips():
    return svc.clips_list()


@app.get("/api/clips/{cid}.wav")
def clip_audio(cid: str):
    p = ROOT / "data/demo/clips" / f"{Path(cid).name}.wav"
    return FileResponse(p, media_type="audio/wav")


@app.post("/api/complaint")
def complaint(body: TextIn):
    if body.add:
        return svc.add_complaint(body.text, body.day, body.hour)
    return {"parsed": svc.parse_complaint(body.text)}


@app.post("/api/voice")
async def voice(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(await file.read())
        tmp.flush()
        return svc.transcribe_upload(tmp.name)


@app.post("/api/kit")
async def kit(file: UploadFile | None = File(None), demo: bool = Form(False), seed: int = Form(0)):
    if demo or file is None:
        img = svc.demo_photo(seed)
    else:
        img = cv2.imdecode(np.frombuffer(await file.read(), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return JSONResponse({"ok": False, "message": "Could not read the image."}, status_code=400)
    return svc.read_kit(img)


@app.post("/api/test")
def add_test(body: TestIn):
    return svc.add_test(body.node, body.day, body.hour, body.failed, body.value)


@app.post("/api/alert/{action}")
def alert_action(action: str, body: ActionIn):
    return svc.alert_action(action, body.actor, body.day, body.hour)


@app.get("/api/audit")
def audit():
    return svc.audit()


@app.post("/api/audit/tamper-test")
def tamper(seq: int = 1):
    return svc.tamper_test(seq)


@app.get("/api/results")
def results():
    return svc.results()


@app.get("/brand/{name}")
def brand(name: str):
    return FileResponse(ROOT / "brand" / Path(name).name)


DIST = ROOT / "web" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="web")
