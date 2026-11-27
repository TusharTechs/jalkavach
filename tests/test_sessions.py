"""On a shared deployment each browser tab has its own scenario (X-Demo-Session)."""
from fastapi.testclient import TestClient

from app.server import app


def test_visitors_do_not_see_each_others_actions():
    c = TestClient(app)
    a, b = {"X-Demo-Session": "visitor-a"}, {"X-Demo-Session": "visitor-b"}
    for h in (a, b):
        assert c.post("/api/reset", headers=h).json()["ok"]
    meta = c.get("/api/meta").json()
    day = meta["alarm_day"]
    text = "क्लिनिक के सामने वाले घरों में कल से पानी मटमैला है"
    r = c.post("/api/complaint", json={"text": text, "day": day, "hour": 19, "add": True}, headers=a).json()
    assert r.get("ok", True)
    n_a = c.get(f"/api/day/{day}?hour=21", headers=a).json()["series"]["complaints"][day]
    n_b = c.get(f"/api/day/{day}?hour=21", headers=b).json()["series"]["complaints"][day]
    assert n_a == n_b + 1
    assert len(c.get(f"/api/audit?day={day}&hour=21", headers=a).json()["rows"]) > len(
        c.get(f"/api/audit?day={day}&hour=21", headers=b).json()["rows"])
    c.post("/api/reset", headers=a)
