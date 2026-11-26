"""Stateful demo service behind the web app. One ward, one session, all offline.

Wraps the engine, intake, kit reader, escalation clock and audit log behind plain methods
returning JSON-ready dicts. app/server.py exposes them over HTTP.
"""
from __future__ import annotations

import base64
import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import cv2
import numpy as np

from .config import ROOT
from .context import build_context
from .escalation import Alert, AuditLog, EscalationEngine
from .intake import Gazetteer, process_text, transcribe
from .kitreader import DPD_SCALE, _rectify, read_photo, simulate_photo
from .posterior import combine, loglik_terms
from .routing import expected_information_gain
from .signals import FieldTest, Observations
from .visual import build_visual

BASE_DATE = datetime(2026, 12, 1)


def _logit(p: float) -> float:
    p = min(max(p, 1e-12), 1 - 1e-12)
    return float(np.log(p / (1 - p)))


@dataclass
class Session:
    extra_complaints: list = field(default_factory=list)   # (node, day, meta)
    extra_tests: list = field(default_factory=list)        # (day, node, failed, kind, meta)
    log: AuditLog = field(default_factory=AuditLog)
    alert: Alert | None = None
    engine: EscalationEngine | None = None


class Service:
    def __init__(self):
        self.ctx, self.ward, self.meta = build_context("demo_ward", offline=True)
        self.replay = json.loads((ROOT / "data/demo/replay.json").read_text())
        self.visual = build_visual(self.ward)
        self.gaz = Gazetteer.load(self.ward)
        self.pois = json.loads((ROOT / "data/cache/pois_demo_ward.json").read_text())
        self.summary = json.loads((ROOT / "results/summary_ward.json").read_text())
        self.clips = json.loads((ROOT / "data/demo/clips/clips.json").read_text())
        tp = ROOT / "data/cache/transcripts.json"
        self.transcripts = json.loads(tp.read_text()) if tp.exists() else {}
        self.thr = float(self.replay["alert_threshold"])
        self.N = len(self.ctx.pop)
        self.D = int(self.replay["obs"]["days"])
        self.lat = np.array([n["lat"] for n in self.replay["nodes"]])
        self.lon = np.array([n["lon"] for n in self.replay["nodes"]])
        self.labels = [self._node_label(i) for i in range(self.N)]
        self.lock = threading.Lock()
        self.reset()

    # ----------------------------------------------------------- helpers
    @staticmethod
    def poi_display(p: dict) -> str:
        return "Govt. school" if "bhagirathpura" in p["name"].lower() else p["name"]

    def _node_label(self, i: int) -> str:
        best, bd = None, 1e9
        for p in self.pois:
            d = ((self.lat[i] - p["lat"]) * 111_000) ** 2 + ((self.lon[i] - p["lon"]) * 102_000) ** 2
            if d < bd:
                best, bd = p, d
        near = f" · near {self.poi_display(best)}" if best is not None and bd ** 0.5 < 150 else ""
        return f"Segment {i}{near}"

    def reset(self) -> dict:
        with getattr(self, "lock", threading.Lock()):
            self.s = Session()
            self.s.engine = EscalationEngine(self.s.log)
        return {"ok": True}

    def now(self, day: int, hour: int) -> datetime:
        return BASE_DATE + timedelta(days=day, hours=hour)

    def observations(self, today: int) -> Observations:
        o = self.replay["obs"]
        C = np.zeros((o["n_nodes"], o["days"]), dtype=int)
        for n, d, c in o["complaints"]:
            C[n, d] += c
        for n, d, _ in self.s.extra_complaints:
            C[n, d] += 1
        tests = [FieldTest(d, n, f, k) for d, n, f, k in o["tests"]]
        tests += [FieldTest(d, n, f, k) for d, n, f, k, _ in self.s.extra_tests]
        return Observations(complaints=C, syndromic=np.array(o["syndromic"]),
                            hospital=np.array(o["hospital"]), tests=[t for t in tests if t.day <= today])

    def posterior(self, today: int):
        return combine(self.ctx, loglik_terms(self.ctx, self.observations(today), today))

    def alert_index(self, p: float) -> float:
        return float(100 / (1 + np.exp(-(_logit(p) - _logit(self.thr)))))

    # ----------------------------------------------------------- static data
    def network(self) -> dict:
        r = self.replay
        feats = self.meta["features"]
        nodes = []
        for i, n in enumerate(r["nodes"]):
            nodes.append({"i": i, "lat": n["lat"], "lon": n["lon"], "pop": round(n["pop"]),
                          "cl": round(n["cl_base"], 3), "label": self.labels[i],
                          "age": float(feats["age"].iloc[i]) if not np.isnan(feats["age"].iloc[i]) else None,
                          "sewer": round(float(feats["sewer"].iloc[i]), 2),
                          "deficit": round(float(feats["pressure"].iloc[i]), 2),
                          "prior": r["prior"][i]})
        vis_pipes = {p["id"]: p for p in self.visual["pipes"]}
        pipes = []
        for e in r["pipes"]:
            v = vis_pipes.get(e["id"], {})
            pipes.append({**e, "from": v.get("from", e["a"]), "to": v.get("to", e["b"]),
                          "flow_lps": v.get("flow_lps", 0.0), "velocity": v.get("velocity", 0.0)})
        pois = [{"name": self.poi_display(p), "kind": p.get("kind", "poi"), "lat": p["lat"], "lon": p["lon"],
                 "pharmacy": any(w in p["name"].lower() for w in ("medical", "medicose"))} for p in self.pois]
        return {"label": r["label"], "provenance": r["provenance"], "nodes": nodes, "pipes": pipes,
                "pois": pois, "trips": self.visual["trips"], "trip_loop_s": self.visual["trip_loop_s"],
                "source": self.visual["source"], "buildings": self.visual.get("buildings", []),
                "center": [float(self.lon.mean()), float(self.lat.mean())]}

    def meta_info(self) -> dict:
        q = self.summary["detection"]["quarterly"]
        loc = self.summary["localisation"]["main"]
        eng = self.s.engine
        return {"days": self.D, "alarm_day": self.replay["alarm_day"], "threshold": self.thr,
                "base_date": BASE_DATE.isoformat(), "note": self.replay["note"],
                "policy": {"stages": eng.stages, "chain": eng.policy["escalation_chain"],
                           "advisory_approver": eng.policy["advisory_approver"],
                           "notify_on_open": eng.policy.get("notify_on_open", [])},
                "headline": {"lead_days": q["lead_F_vs_H"], "detected_F": q["F"]["detected"][0],
                             "detected_H": q["H"]["detected"][0], "top3_F": loc["top3@3:F"][0],
                             "top3_CC": loc["top3@3:CC"][0], "coverage": loc["coverage90:F"][0]}}

    # ----------------------------------------------------------- day state
    def day_state(self, day: int, hour: int = 17) -> dict:
        with self.lock:
            day = int(np.clip(day, 2, self.D - 1))
            post = self.posterior(day)
            alerting = post.p_event >= self.thr
            now = self.now(day, hour)
            if alerting and self.s.alert is None:
                first = next(d for d in range(2, day + 1) if self.posterior(d).p_event >= self.thr)
                pf = self.posterior(first)
                cands = [{"node": int(i), "p": float(pf.p_location[i]), "label": self.labels[int(i)]}
                         for i in pf.top_k(3)]
                self.s.alert = self.s.engine.open_alert(
                    f"JK-{first:02d}-W1", "Demo ward", self.now(first, 9), pf.p_event, cands,
                    {k: round(v, 2) for k, v in pf.contributions.items()})
            if self.s.alert is not None:
                self.s.engine.tick(self.s.alert, now)
            top = post.top_k(5)
            sugg, eig = [], None
            if alerting:
                eig = expected_information_gain(self.ctx, post, min(day + 1, self.D - 1))
                sugg = [{"node": int(i), "eig": round(float(eig[i]), 4), "label": self.labels[int(i)]}
                        for i in np.argsort(-eig)[:2]]
            obs = self.observations(day)
            series = {
                "complaints": obs.complaints.sum(axis=0)[: day + 1].tolist(),
                "pharmacy": [int(x) for x in self.replay["obs"]["syndromic"][: day + 1]],
                "alert_index": [round(self.alert_index(self.posterior(d).p_event), 1) if d >= 2 else 0.0
                                for d in range(0, day + 1)],
            }
            complaints = [{"node": int(n), "day": int(d), "count": int(obs.complaints[n, d])}
                          for n, d in np.argwhere(obs.complaints[:, : day + 1] > 0)]
            tests = [{"node": t.node, "day": t.day, "failed": t.failed, "kind": t.kind} for t in obs.tests]
            mapc = int(top[0])
            plume = {"node": mapc, "arrival_h": self.visual["arrival_h"][mapc],
                     "reach": [round(float(x), 4) for x in self.ctx.R[mapc]]}
            ce = self.s.alert
            esc = None
            if ce is not None:
                st = self.s.engine.status(ce, now)
                esc = {"id": ce.id, "opened": ce.opened.isoformat(), "status": ce.status,
                       "stage_index": ce.stage_index, "stage": st["stage"], "owner": st["owner"],
                       "due": st["due"].isoformat() if st["due"] else None,
                       "remaining_h": round(st.get("remaining_h", 0.0), 1), "overdue_h": round(st["overdue_h"], 1),
                       "escalated_to": st["escalated_to"], "work_order": ce.work_order, "advisory": ce.advisory}
            return {
                "day": day, "hour": hour, "now": now.isoformat(),
                "p_event": post.p_event, "alert_index": round(self.alert_index(post.p_event), 1),
                "status": "ALERT" if alerting else ("WATCH" if self.alert_index(post.p_event) > 35 else "NORMAL"),
                "p_location": [round(float(x), 5) for x in post.p_location],
                "top": [{"node": int(i), "p": float(post.p_location[i]), "label": self.labels[int(i)]} for i in top],
                "credible90": [int(i) for i in post.credible_set(0.9)],
                "contributions": {k: round(v, 2) for k, v in post.contributions.items()},
                "map_onset": post.map_onset, "map_intensity": post.map_intensity,
                "suggested": sugg, "series": series, "complaints": complaints, "tests": tests,
                "plume": plume, "escalation": esc,
                "extras": {"complaints": len(self.s.extra_complaints), "tests": len(self.s.extra_tests)},
            }

    # ----------------------------------------------------------- intake
    def clips_list(self) -> list[dict]:
        out = []
        for c in self.clips:
            tr = [v["text"] for v in self.transcripts.values() if v.get("file") == f"{c['id']}.wav"]
            out.append({**c, "transcript": tr[0] if tr else None, "asr": "faster-whisper medium (local)" if tr else None})
        return out

    def parse_complaint(self, text: str) -> dict:
        c = process_text(text, self.gaz)
        d = c.as_dict()
        if d.get("place_match"):
            d["place_match"] = "Govt. school" if "bhagirathpura" in d["place_match"].lower() else d["place_match"]
        if c.node is not None:
            d["label"] = self.labels[c.node]
            d["lat"], d["lon"] = float(self.lat[c.node]), float(self.lon[c.node])
        return d

    def add_complaint(self, text: str, day: int, hour: int, channel: str = "311 voice") -> dict:
        d = self.parse_complaint(text)
        if d["node"] is None or not d["water_quality"]:
            return {"added": False, "parsed": d, "reason": "not geocoded or not a water-quality complaint"}
        with self.lock:
            self.s.extra_complaints.append((d["node"], int(day), {"text": text}))
            self.s.log.append(self.now(day, hour), f"Citizen ({channel})", "complaint_added",
                              self.s.alert.id if self.s.alert else "-",
                              {"node": d["node"], "colour": d["colour"], "odour": d["odour"], "symptoms": d["symptoms"]})
        return {"added": True, "parsed": d}

    def transcribe_upload(self, path: str) -> dict:
        try:
            text = transcribe(path)
            return {"ok": True, "text": text, "parsed": self.parse_complaint(text)}
        except Exception as exc:  # pragma: no cover - depends on optional extra
            return {"ok": False, "error": str(exc)}

    # ----------------------------------------------------------- kit
    def demo_photo(self, seed: int = 0) -> np.ndarray:
        return simulate_photo(DPD_SCALE[1][1], np.random.default_rng(seed))

    def read_kit(self, img: np.ndarray) -> dict:
        r = read_photo(img)
        det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50),
                                      cv2.aruco.DetectorParameters())
        corners, ids, _ = det.detectMarkers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        h, w = img.shape[:2]
        marks = [] if ids is None else [{"id": int(i), "pts": (c[0] / [w, h]).round(4).tolist()}
                                         for c, i in zip(corners, ids.ravel())]
        rect = _rectify(img)

        def b64(x):
            ok, buf = cv2.imencode(".jpg", x, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return "data:image/jpeg;base64," + base64.b64encode(buf).decode()

        return {"ok": r.ok, "value": r.value_mg_l, "below": r.below_threshold, "margin": r.margin,
                "message": r.message, "markers": marks, "photo": b64(img),
                "rectified": b64(rect) if rect is not None else None,
                "scale": [{"mg": m, "rgb": c} for m, c in DPD_SCALE]}

    def add_test(self, node: int, day: int, hour: int, failed: bool, value: float | None) -> dict:
        with self.lock:
            self.s.extra_tests.append((int(day), int(node), bool(failed), "chlorine", {"value": value}))
            self.s.log.append(self.now(day, hour), "Amrut Mitra field team", "field_test_added",
                              self.s.alert.id if self.s.alert else "-",
                              {"node": int(node), "mg_l": None if value is None else round(value, 2),
                               "below_0_2": bool(failed)})
        return {"added": True}

    # ----------------------------------------------------------- escalation
    def alert_action(self, action: str, actor: str, day: int, hour: int, labels_from_day: int | None = None) -> dict:
        with self.lock:
            a, eng = self.s.alert, self.s.engine
            if a is None:
                return {"ok": False, "error": "no alert"}
            now = self.now(day, hour)
            if action == "acknowledge" and a.stage_index == 0 and a.status == "open":
                eng.complete_stage(a, actor, now, "acknowledged")
            elif action == "samples" and a.stage_index == 1 and a.status == "open":
                eng.complete_stage(a, actor, now, "samples recorded", {"tests": len(self.s.extra_tests)})
            elif action == "confirm" and a.stage_index == 2 and a.status == "open":
                post = combine(self.ctx, loglik_terms(self.ctx, self.observations(day), day))
                a.candidates = [{"node": int(i), "p": float(post.p_location[i]), "label": self.labels[int(i)]}
                                for i in post.top_k(3)]
                eng.confirm(a, actor, now, [c["label"] for c in a.candidates])
            elif action == "clear" and a.stage_index == 2 and a.status == "open":
                eng.clear(a, actor, now, "field tests normal")
            elif action in ("approve_work_order", "approve_advisory") and a.status == "confirmed":
                who = actor if action == "approve_work_order" else eng.policy["advisory_approver"]
                eng.approve(a, action.replace("approve_", ""), who, now)
            else:
                return {"ok": False, "error": f"'{action}' not allowed at this stage"}
        return {"ok": True}

    # ----------------------------------------------------------- audit
    def audit(self) -> dict:
        rows = self.s.log.rows()
        ok, bad = self.s.log.verify()
        return {"ok": ok, "bad": bad, "rows": [{**r, "payload": json.loads(r["payload"])} for r in rows]}

    def tamper_test(self, seq: int = 1) -> dict:
        import sqlite3

        cp = AuditLog()
        cp.db = sqlite3.connect(":memory:")
        self.s.log.db.backup(cp.db)
        cp.db.execute("UPDATE audit SET payload = payload || ' ' WHERE seq = ?", (seq,))
        ok, bad = cp.verify()
        return {"ok": ok, "broken_at": bad, "rows": len(cp.rows())}

    # ----------------------------------------------------------- results
    def results(self) -> dict:
        import pandas as pd

        ev = pd.read_csv(ROOT / "results/events_ward.csv")
        main = ev[ev["set"] == "main"]
        curves = {}
        for m in ("F", "C", "S", "T", "CC", "H"):
            col = f"quarterly:{m}"
            if col not in main:
                continue
            dl = np.where(main[col].isna(), np.inf, main[col]) - main["t0"]
            curves[m] = [round(float((dl <= x).mean()), 4) for x in range(0, 15)]
        return {"summary": self.summary, "cdf": curves,
                "net3": json.loads((ROOT / "results/summary_net3.json").read_text())["detection"]["quarterly"]}
