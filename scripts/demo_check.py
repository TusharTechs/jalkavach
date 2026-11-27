"""Pre-stage check: every endpoint answers, the story path works, the speech model loads,
and the committed web build is newer than its sources.

    make demo-check
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.server import app, svc  # noqa: E402

ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('  ' + detail) if detail else ''}")


def main() -> int:
    c = TestClient(app)
    print("JalKavach demo check")
    meta = c.get("/api/meta").json()
    A = meta["alarm_day"]
    check("meta", "headline" in meta, f"alert day {A}")
    check("network", len(c.get("/api/network").json()["nodes"]) > 50)
    c.post("/api/reset")
    check("before alert: NORMAL", c.get(f"/api/day/{A}?hour=17").json()["status"] == "NORMAL")
    s = c.get(f"/api/day/{A}?hour=18").json()
    check("alert opens at 18:00", s["status"] == "ALERT", f"search {s['total_km']} → {s['search_km']} km, ≈{s['exposed_people']} people")
    clips = c.get("/api/clips").json()
    check("demo clips", len(clips) >= 4 and c.get(f"/api/clips/{clips[0]['id']}.wav").status_code == 200)
    src = (ROOT / "web/src/components/Story.tsx").read_text()
    STORY_COMPLAINT = src.split('STORY_COMPLAINT = "', 1)[1].split('"', 1)[0]     # the story's complaint must geocode
    place = src.split('STORY_PLACE = "', 1)[1].split('"', 1)[0]
    p = c.post("/api/complaint", json={"text": STORY_COMPLAINT}).json()["parsed"]
    opt = [o for o in p["options"] if o["name"] == place]
    check("story landmark exists and is offered", bool(opt), place)
    r = c.post("/api/complaint", json={"text": STORY_COMPLAINT, "day": A, "hour": 19, "add": True,
                                       "node": opt[0]["node"] if opt else None}).json()
    check("story complaint geocodes and is added", r.get("added", False), r.get("parsed", {}).get("place_match") or r.get("reason", ""))
    stages = meta["policy"]["stages"]
    for act, who, d, h in [("acknowledge", stages[0]["owner"], A, 20), ("samples", stages[1]["owner"], A + 1, 11),
                           ("confirm", stages[2]["owner"], A + 1, 19), ("approve_advisory", meta["policy"]["advisory_approver"], A + 1, 20)]:
        check(f"story action: {act}", c.post(f"/api/alert/{act}", json={"actor": who, "day": d, "hour": h}).json().get("ok", False))
    a = c.get(f"/api/audit?day={A + 1}&hour=21").json()
    check("audit chain intact", a["ok"], f"{len(a['rows'])} entries")
    check("tamper test breaks the chain", c.post(f"/api/audit/tamper-test?day={A + 1}&hour=21").json()["broken_at"] == 1)
    check("export pack", c.get(f"/api/export?day={A + 1}&hour=21").json()["alert"] is not None)
    check("kit reader (demo photo)", c.post("/api/kit", data={"demo": "true"}).json()["ok"])
    check("results", "cdf" in c.get("/api/results").json())
    c.post("/api/reset")
    t0 = time.time()
    while svc.asr_status()["state"] == "warming" and time.time() - t0 < 180:
        time.sleep(2)
    st = svc.asr_status()
    check("speech model", st["state"] == "ready", st["label"])
    if st["state"] == "ready":
        tr = c.post(f"/api/transcribe/{clips[0]['id']}").json()
        check("live Hindi transcription", tr["ok"] and len(tr["text"]) > 5, f"{tr.get('seconds')} s")
    dist = ROOT / "web/dist/index.html"
    newest = max(p.stat().st_mtime for p in (ROOT / "web/src").rglob("*") if p.is_file())
    check("web build is up to date", dist.exists() and dist.stat().st_mtime >= newest)
    print("READY" if ok else "NOT READY")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
