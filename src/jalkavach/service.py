"""Stateful demo service behind the web app. One ward, one session, all offline.

Design rule: everything shown is a PURE FUNCTION of (day, hour, recorded actions).
- The session stores only actions (a complaint added, a field test added, a stage acted
  on), each stamped with the simulated time it happened.
- Every request rebuilds the alert, the escalation clock and the hash-chained audit log
  from scratch by replaying those actions up to "now". Scrubbing the timeline backwards
  and forwards is therefore always consistent, and GET requests have no side effects.
- The engine evaluates each day's signals at EVAL_HOUR; an alert opens at that time on
  the first day the calibrated threshold is crossed.
"""
from __future__ import annotations

import base64
import hashlib
import json
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np

from .config import ROOT
from .context import build_context
from .escalation import AuditLog, EscalationEngine
from .intake import Gazetteer, process_text, transcribe
from .kitreader import DPD_SCALE, _rectify, read_photo, simulate_photo
from .network import supply_on_mask
from .posterior import combine, loglik_terms
from .routing import expected_information_gain
from .signals import FieldTest, Observations
from .visual import build_visual

BASE_DATE = datetime(2026, 12, 1)
EVAL_HOUR = 18


def _logit(p: float) -> float:
    p = min(max(p, 1e-12), 1 - 1e-12)
    return float(np.log(p / (1 - p)))


class Service:
    def __init__(self):
        self.ctx, self.ward, self.meta = build_context("demo_ward", offline=True)
        self.replay = json.loads((ROOT / "data/demo/replay.json").read_text())
        self.visual = build_visual(self.ward)
        self.gaz = Gazetteer.load(self.ward)
        self.pois = json.loads((ROOT / f"data/cache/pois_{self.ward.cfg['name']}.json").read_text())
        self.summary = json.loads((ROOT / "results/summary_ward.json").read_text())
        self.clips = json.loads((ROOT / "data/demo/clips/clips.json").read_text())
        tp = ROOT / "data/cache/transcripts.json"
        self.transcripts = json.loads(tp.read_text()) if tp.exists() else {}
        self.thr = float(self.replay["alert_threshold"])
        self.N = len(self.ctx.pop)
        self.D = int(self.replay["obs"]["days"])
        self.lat = np.array([n["lat"] for n in self.replay["nodes"]])
        self.lon = np.array([n["lon"] for n in self.replay["nodes"]])
        both = [self._node_label(i) for i in range(self.N)]
        self.labels = [b[0] for b in both]
        self.labels_hi = [b[1] for b in both]
        self.on_hours = supply_on_mask(self.ward.cfg["supply"]["windows"])
        names = list(self.ward.nodes.index)
        self.pipe_km = {pid: float(p.length) / 1000 for pid, p in self.ward.pipes.iterrows()}
        self.pipe_ends = {pid: (names.index(p.start), names.index(p.end)) for pid, p in self.ward.pipes.iterrows()}
        self.total_km = sum(self.pipe_km.values())
        self.lock = threading.Lock()
        self._post_cache: dict = {}
        self.actions: list[dict] = []
        self._whisper = None
        self._whisper_thread = threading.Thread(target=self._warm_whisper, daemon=True)
        self._whisper_thread.start()

    # ----------------------------------------------------------- labels
    @staticmethod
    def _poi_hi(p: dict) -> str:
        tail = p["name"].split()[-1]
        suffix = f" {tail}" if (tail.isdigit() or (len(tail) == 1 and tail.isalpha())) and tail != p["name"] else ""
        return (p.get("name_hi") or p["name"]) + suffix

    def _node_label(self, i: int) -> tuple[str, str]:
        """('Lane 59 · 120 m NE of Park 2', 'गली 59 · पार्क 2 से 120 मी उत्तर-पूर्व').
        Generic landmark types only, never business names."""
        best, bd, dy, dx = None, 1e18, 0.0, 0.0
        for p in self.pois:
            y = (self.lat[i] - p["lat"]) * 111_000
            x = (self.lon[i] - p["lon"]) * 102_000
            if x * x + y * y < bd:
                best, bd, dy, dx = p, x * x + y * y, y, x
        if best is None or bd ** 0.5 > 450:
            return f"Lane {i}", f"गली {i}"
        dist = bd ** 0.5
        hi = self._poi_hi(best)
        if dist < 40:
            return f"Lane {i} · at {best['name']}", f"गली {i} · {hi} के पास"
        ang = (np.degrees(np.arctan2(dx, dy)) + 360) % 360
        k = int((ang + 22.5) // 45) % 8
        compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][k]
        dish = ["उत्तर", "उत्तर-पूर्व", "पूर्व", "दक्षिण-पूर्व", "दक्षिण", "दक्षिण-पश्चिम", "पश्चिम", "उत्तर-पश्चिम"][k]
        m = int(round(dist / 10) * 10)
        return f"Lane {i} · {m} m {compass} of {best['name']}", f"गली {i} · {hi} से {m} मी {dish}"

    def now(self, day: int, hour: int) -> datetime:
        return BASE_DATE + timedelta(days=day, hours=hour)

    def reset(self) -> dict:
        with self.lock:
            self.actions = []
            self._post_cache = {}
        return {"ok": True}

    # ----------------------------------------------------------- engine
    def _extras(self, kind: str, cutoff: datetime) -> list[dict]:
        """Recorded actions of one kind that had happened by `cutoff` (causal: never the future)."""
        return [a for a in self.actions if a["kind"] == kind and a["ts"] <= cutoff]

    def observations(self, today: int, cutoff: datetime | None = None) -> Observations:
        cutoff = cutoff or self.now(today, EVAL_HOUR)
        o = self.replay["obs"]
        C = np.zeros((o["n_nodes"], o["days"]), dtype=int)
        for n, d, c in o["complaints"]:
            C[n, d] += c
        for a in self._extras("complaint", cutoff):
            C[a["node"], min(a["day"], today)] += 1
        tests = [FieldTest(d, n, f, k) for d, n, f, k in o["tests"]]
        tests += [FieldTest(min(a["day"], today), a["node"], a["failed"], "chlorine") for a in self._extras("test", cutoff)]
        return Observations(complaints=C, syndromic=np.array(o["syndromic"]),
                            hospital=np.array(o["hospital"]), tests=[t for t in tests if t.day <= today])

    def posterior(self, today: int, cutoff: datetime | None = None):
        """Posterior from evidence available at `cutoff` (default: that day's scheduled run at EVAL_HOUR).

        Alerts are decided only by the scheduled runs; once an alert is open, the ranking is
        refreshed live as new evidence arrives (cutoff = now)."""
        cutoff = cutoff or self.now(today, EVAL_HOUR)
        sig = (today, tuple((a["kind"], min(a["day"], today), a.get("node"), a.get("failed"))
                            for a in self.actions if a["kind"] in ("complaint", "test") and a["ts"] <= cutoff))
        if sig not in self._post_cache:
            self._post_cache[sig] = combine(self.ctx, loglik_terms(self.ctx, self.observations(today, cutoff), today))
        return self._post_cache[sig]

    def exposed_people(self, nodes: list[int], min_reach: float = 0.03) -> int:
        """Residents whose water can pass through any candidate junction (EPANET source trace).

        An upper bound on who could be exposed if the ingress is in the credible set."""
        if not nodes:
            return 0
        reach = self.ctx.R[np.asarray(nodes)].max(axis=0)
        return int(round(float(self.ctx.pop[reach > min_reach].sum()), -1))

    def alert_index(self, p: float) -> float:
        return float(min(99.0, 100 / (1 + np.exp(-(_logit(p) - _logit(self.thr))))))

    def first_alarm_day(self, upto: int) -> int | None:
        for d in range(2, upto + 1):
            if self.posterior(d).p_event >= self.thr:
                return d
        return None

    # ----------------------------------------------------------- replay → alert + audit
    def _rebuild(self, now: datetime):
        """Rebuild alert, escalation clock and audit log from recorded actions up to `now`."""
        log = AuditLog()
        eng = EscalationEngine(log)
        day = (now - BASE_DATE).days
        first = self.first_alarm_day(day)
        opened = self.now(first, EVAL_HOUR) if first is not None else None
        alert = None
        events = sorted([a for a in self.actions if a["ts"] <= now], key=lambda a: a["ts"])
        pending_open = opened is not None and opened <= now
        for a in events:
            if pending_open and opened <= a["ts"]:
                alert = self._open(eng, first, opened)
                pending_open = False
            if alert is not None:
                eng.tick(alert, a["ts"])
            self._apply(eng, alert, log, a)
        if pending_open:
            alert = self._open(eng, first, opened)
        if alert is not None:
            eng.tick(alert, now)
        return alert, eng, log

    def _open(self, eng, first: int, opened: datetime):
        pf = self.posterior(first)
        cands = [{"node": int(i), "p": float(pf.p_location[i]), "label": self.labels[int(i)]} for i in pf.top_k(3)]
        a = eng.open_alert(f"JK-{first:02d}-W00", "Ward 00 · Demo Nagar", opened, pf.p_event, cands,
                           {k: round(v, 2) for k, v in pf.contributions.items()})
        a.opened_label = f"Day {first}, {EVAL_HOUR:02d}:00 (simulation clock)"
        return a

    def _apply(self, eng, alert, log, a: dict) -> None:
        aid = alert.id if alert else "-"
        if a["kind"] == "complaint":
            log.append(a["ts"], f"Citizen ({a['channel']})", "complaint_added", aid,
                       {"node": a["node"], "colour": a["colour"], "odour": a["odour"], "symptoms": a["symptoms"]})
        elif a["kind"] == "test":
            log.append(a["ts"], "Amrut Mitra field team", "field_test_added", aid,
                       {"node": a["node"], "mg_l": a["value"], "below_0_2": a["failed"]})
        elif a["kind"] == "stage" and alert is not None:
            act, actor = a["action"], a["actor"]
            why = {"reason_for_delay": a["note"]} if a.get("note") else None
            if act == "acknowledge" and alert.stage_index == 0 and alert.status == "open":
                eng.complete_stage(alert, actor, a["ts"], "acknowledged", why)
            elif act == "samples" and alert.stage_index == 1 and alert.status == "open":
                eng.complete_stage(alert, actor, a["ts"], "field tests recorded", why)
            elif act == "confirm" and alert.stage_index == 2 and alert.status == "open":
                post = self.posterior(a["day"], a["ts"])
                alert.candidates = [{"node": int(i), "p": float(post.p_location[i]), "label": self.labels[int(i)]}
                                    for i in post.top_k(3)]
                eng.confirm(alert, actor, a["ts"], [c["label"] for c in alert.candidates],
                            [self.labels_hi[c["node"]] for c in alert.candidates])
            elif act == "clear" and alert.stage_index == 2 and alert.status == "open":
                eng.clear(alert, actor, a["ts"], "field tests normal")
            elif act in ("approve_work_order", "approve_advisory") and alert.status == "confirmed":
                who = actor if act == "approve_work_order" else eng.policy["advisory_approver"]
                eng.approve(alert, act.replace("approve_", ""), who, a["ts"])

    # ----------------------------------------------------------- static data
    def network(self) -> dict:
        r = self.replay
        feats = self.meta["features"]
        nodes = []
        for i, n in enumerate(r["nodes"]):
            age = feats["age"].iloc[i]
            nodes.append({"i": i, "lat": n["lat"], "lon": n["lon"], "pop": round(n["pop"]),
                          "cl": round(n["cl_base"], 3), "label": self.labels[i], "label_hi": self.labels_hi[i],
                          "age": None if np.isnan(age) else float(age),
                          "sewer": round(float(feats["sewer"].iloc[i]), 2),
                          "deficit": round(float(feats["pressure"].iloc[i]), 2), "prior": r["prior"][i]})
        vis = {p["id"]: p for p in self.visual["pipes"]}
        pipes = [{**e, "from": vis.get(e["id"], {}).get("from", e["a"]), "to": vis.get(e["id"], {}).get("to", e["b"]),
                  "flow_lps": vis.get(e["id"], {}).get("flow_lps", 0.0), "velocity": vis.get(e["id"], {}).get("velocity", 0.0)}
                 for e in r["pipes"]]
        pois = [{"name": p["name"], "name_hi": self._poi_hi(p), "kind": p["kind"], "lat": p["lat"], "lon": p["lon"],
                 "pharmacy": p["kind"] == "Medical store"} for p in self.pois]
        return {"label": r["label"], "provenance": r["provenance"], "nodes": nodes, "pipes": pipes, "pois": pois,
                "trips": self.visual["trips"], "trip_loop_s": self.visual["trip_loop_s"], "source": self.visual["source"],
                "buildings": self.visual.get("buildings", []), "center": [float(self.lon.mean()), float(self.lat.mean())],
                "total_km": round(self.total_km, 2)}

    def meta_info(self) -> dict:
        q = self.summary["detection"]["quarterly"]
        loc = self.summary["localisation"]["main"]
        uni = self.summary["localisation"].get("uniform_truth", {})
        o = self.replay["obs"]
        C = np.zeros((o["n_nodes"], o["days"]), dtype=int)
        for n, d, c in o["complaints"]:
            C[n, d] += c
        eng = EscalationEngine(AuditLog())
        return {"days": self.D, "alarm_day": self.replay["alarm_day"], "threshold": self.thr,
                "base_date": BASE_DATE.isoformat(), "note": self.replay["note"], "eval_hour": EVAL_HOUR,
                "supply_windows": self.ward.cfg["supply"]["windows"],
                "scales": {"complaints": int(C.sum(axis=0).max()) + 4, "pharmacy": int(max(o["syndromic"])) + 4,
                           "pharmacy_base": self.ctx.params.syndromic_base},
                "policy": {"stages": eng.stages, "chain": eng.policy["escalation_chain"],
                           "advisory_approver": eng.policy["advisory_approver"],
                           "notify_on_open": eng.policy.get("notify_on_open", []),
                           "escalate_every_hours": eng.policy["escalate_every_hours"]},
                "headline": {"lead_days": q["lead_F_vs_H"], "detected_F": q["F"]["detected"][0],
                             "detected_H": q["H"]["detected"][0], "detected_CC": q["CC"]["detected"][0],
                             "detected_C": q["C"]["detected"][0],
                             "det_gain_vs_CC": q["detect_rate_diff_F_vs_CC"],
                             "routing": {k: {"median": self.summary["routing"][k]["median_tests_to_top3"][0],
                                             "mean": round(self.summary["routing"][k]["mean_tests_to_top3"][0], 1)}
                                         for k in ("info_gain", "random")},
                             # declared power extension on fresh seeds (PREREGISTRATION.md, 27 Nov)
                             "routing_ext": json.loads((ROOT / "results/routing_extension.json").read_text())
                             if (ROOT / "results/routing_extension.json").exists() else None,
                             "n_junctions": int(self.N),
                             "equity_detected": {k: v["detected_F"] for k, v in self.summary["equity"].items()},
                             "det_gain_vs_CC_monthly": self.summary["detection"]["monthly"]["detect_rate_diff_F_vs_CC"],
                             "top3_F": loc["top3@3:F"][0], "top3_C": loc["top3@3:C"][0], "top3_CC": loc["top3@3:CC"][0],
                             "top3_F_uniform": uni.get("top3@3:F", [None])[0],
                             "coverage": loc["coverage90:F"][0], "coverage_uniform": uni.get("coverage90:F", [None])[0],
                             "n_main": loc.get("n"), "n_scenarios": self.summary["n_event"] + self.summary["n_null"]}}

    # ----------------------------------------------------------- day state
    def day_state(self, day: int, hour: int = EVAL_HOUR) -> dict:
        with self.lock:
            day = int(np.clip(day, 2, self.D - 1))
            hour = int(np.clip(hour, 0, 23))
            now = self.now(day, hour)
            # the engine evaluates each day at EVAL_HOUR; before that, show yesterday's evaluation
            eval_day = day if hour >= EVAL_HOUR else max(2, day - 1)
            alert, eng, log = self._rebuild(now)
            alerting = alert is not None
            post = self.posterior(eval_day, now if alerting else None)
            top = post.top_k(5)
            sugg = []
            if alerting:
                eig = expected_information_gain(self.ctx, post, min(eval_day + 1, self.D - 1))
                sugg = [{"node": int(i), "eig": round(float(eig[i]), 4), "label": self.labels[int(i)],
                         "label_hi": self.labels_hi[int(i)]}
                        for i in np.argsort(-eig)[:2]]
            obs = self.observations(day, now)
            cred = [int(i) for i in post.credible_set(0.9)]
            cred_set = set(cred)
            exposed = self.exposed_people(cred)
            search_km = sum(km for pid, km in self.pipe_km.items()
                            if self.pipe_ends[pid][0] in cred_set or self.pipe_ends[pid][1] in cred_set)
            mapc = int(top[0])
            truth = self.replay["truth"]
            esc = None
            if alert is not None:
                st = eng.status(alert, now)
                esc = {"id": alert.id, "opened": alert.opened.isoformat(), "status": alert.status,
                       "stage_index": alert.stage_index, "stage": st["stage"], "owner": st["owner"],
                       "due": st["due"].isoformat() if st["due"] else None,
                       "remaining_h": round(st.get("remaining_h", 0.0), 1), "overdue_h": round(st["overdue_h"], 1),
                       "escalated_to": st["escalated_to"], "work_order": alert.work_order, "advisory": alert.advisory,
                       "approved": [r["action"].split(":", 1)[1] for r in log.rows() if r["action"].startswith("approved:")]}
            return {
                "day": day, "hour": hour, "eval_day": eval_day, "now": now.isoformat(),
                "supply_on": bool(self.on_hours[hour]),
                "p_event": post.p_event, "alert_index": round(self.alert_index(post.p_event), 1),
                "status": "ALERT" if alerting else "NORMAL",
                "p_location": [round(float(x), 5) for x in post.p_location],
                "top": [{"node": int(i), "p": float(post.p_location[i]), "label": self.labels[int(i)],
                         "label_hi": self.labels_hi[int(i)]} for i in top],
                "credible90": cred, "exposed_people": exposed, "search_km": round(search_km, 2), "total_km": round(self.total_km, 2),
                "contributions": {k: round(v, 2) for k, v in post.contributions.items()},
                "onset_range": [int(post.onsets[np.argsort(-post.p_onset)[:2]].min()),
                                int(post.onsets[np.argsort(-post.p_onset)[:2]].max())],
                "suggested": sugg,
                "series": {
                    "complaints": obs.complaints.sum(axis=0)[: day + 1].tolist(),
                    "pharmacy": [int(x) for x in self.replay["obs"]["syndromic"][: day + 1]],
                    "alert_index": [round(self.alert_index(self.posterior(d).p_event), 1) if d >= 2 else 0.0
                                    for d in range(0, eval_day + 1)],
                },
                "complaints": [{"node": int(n), "day": int(d), "count": int(obs.complaints[n, d])}
                               for n, d in np.argwhere(obs.complaints[:, : day + 1] > 0)],
                "tests": [{"node": t.node, "day": t.day, "failed": t.failed, "kind": t.kind} for t in obs.tests],
                "plume": {"node": mapc, "p": float(post.p_location[mapc]),
                          "arrival_h": self.visual["arrival_h"][mapc],
                          "reach": [round(float(x), 4) for x in self.ctx.R[mapc]]},
                "truth": ({"node": truth["node"], "label": self.labels[truth["node"]], "label_hi": self.labels_hi[truth["node"]], "onset_day": truth["onset_day"],
                           "rank": post.rank_of(truth["node"]) + 1} if alerting else None),
                "escalation": esc,
                "extras": {"complaints": len(self._extras("complaint", now)), "tests": len(self._extras("test", now)),
                           "actions": len(self.actions)},
            }

    # ----------------------------------------------------------- intake
    def clips_list(self) -> list[dict]:
        out = []
        for c in self.clips:
            tr = [v for v in self.transcripts.values() if v.get("file") == f"{c['id']}.wav"]
            out.append({**c, "transcript": tr[0]["text"] if tr else None})
        return out

    def parse_complaint(self, text: str) -> dict:
        c = process_text(text, self.gaz)
        d = c.as_dict()
        if c.node is not None:
            d["label"] = self.labels[c.node]
            d["lat"], d["lon"] = float(self.lat[c.node]), float(self.lon[c.node])
        d["ambiguous"] = c.candidates > 1
        d["options"] = [{**o, "label": self.labels[o["node"]]} for o in c.options]
        return d

    def record(self, kind: str, day: int, hour: int, **kw) -> dict:
        with self.lock:
            a = {"kind": kind, "day": int(day), "hour": int(hour), "ts": self.now(day, hour), **kw}
            self.actions.append(a)
            self._post_cache = {}
        return a

    def _clip_time(self, day: int, hour: int) -> tuple[int, int]:
        return int(np.clip(day, 2, self.D - 1)), int(np.clip(hour, 0, 23))

    def _live(self, day: int, hour: int):
        """Posterior with all evidence available right now (what the screen shows)."""
        return self.posterior(day if hour >= EVAL_HOUR else max(2, day - 1), self.now(day, hour))

    def add_complaint(self, text: str, day: int, hour: int, channel: str = "voice note",
                      node: int | None = None) -> dict:
        day, hour = self._clip_time(day, hour)
        d = self.parse_complaint(text)
        if node is not None:                       # the officer picked one of the ambiguous landmarks
            chosen = [o for o in d.get("options", []) if o["node"] == node]
            if not chosen:
                return {"added": False, "parsed": d, "reason": "that place is not one of the matches"}
            d["node"], d["label"], d["place_match"] = int(node), self.labels[int(node)], chosen[0]["name"]
            d["lat"], d["lon"] = float(self.lat[int(node)]), float(self.lon[int(node)])
            d["ambiguous"] = False
        if d["node"] is None or not d["water_quality"]:
            return {"added": False, "parsed": d, "reason": "no known landmark heard, or not about water quality"}
        if d.get("ambiguous"):
            return {"added": False, "parsed": d, "reason": f"{d['candidates']} places match: choose which one"}
        before = self._live(day, hour).p_location[d["node"]]
        self.record("complaint", day, hour, node=d["node"], channel=channel,
                    colour=d["colour"], odour=d["odour"], symptoms=d["symptoms"])
        after = self._live(day, hour).p_location[d["node"]]
        return {"added": True, "parsed": d, "p_before": float(before), "p_after": float(after)}

    # whisper: warm the model once in the background so the first live transcription is quick
    def _warm_whisper(self):
        try:
            from faster_whisper import WhisperModel
            self._whisper = WhisperModel("medium", device="cpu", compute_type="int8")
        except Exception:
            self._whisper = None

    def asr_status(self) -> dict:
        if self._whisper_thread is not None and self._whisper_thread.is_alive():
            return {"state": "warming", "label": "Hindi speech model loading (about a minute after start)"}
        if self._whisper is None:
            return {"state": "unavailable", "label": "speech model not installed: cached transcripts are used"}
        return {"state": "ready", "label": "faster-whisper medium · ready on this laptop"}

    def _wav16k(self, src: str) -> str:
        out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        try:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", out],
                           check=True, timeout=60)
        except (FileNotFoundError, subprocess.SubprocessError) as exc:
            Path(out).unlink(missing_ok=True)
            raise RuntimeError("could not convert the recording (is ffmpeg installed?)") from exc
        return out

    def transcribe_live(self, path: str, convert: bool = True) -> dict:
        """Run local faster-whisper on the audio now (no cache), and time it."""
        t0 = time.time()
        if self._whisper is None:
            why = "model still loading" if self.asr_status()["state"] == "warming" else "local ASR model unavailable"
            try:
                text = transcribe(path)  # cached transcript
                return {"ok": True, "text": text, "source": f"cached transcript ({why})",
                        "seconds": round(time.time() - t0, 2), "parsed": self.parse_complaint(text)}
            except Exception as exc:
                return {"ok": False, "error": f"{why}; no cached transcript for this audio ({exc})"}
        from .intake import _load_wav
        try:
            wav = self._wav16k(path) if convert else path
        except RuntimeError as exc:
            return {"ok": False, "error": str(exc)}
        try:
            segs, _ = self._whisper.transcribe(_load_wav(wav), language="hi", beam_size=5)
            text = " ".join(s.text.strip() for s in segs).strip()
        finally:
            if convert:
                Path(wav).unlink(missing_ok=True)
        return {"ok": True, "text": text, "source": "faster-whisper medium · on this laptop",
                "seconds": round(time.time() - t0, 2), "parsed": self.parse_complaint(text)}

    def transcribe_clip(self, cid: str) -> dict:
        p = ROOT / "data/demo/clips" / f"{cid}.wav"
        return self.transcribe_live(str(p), convert=False)

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
        if not 0 <= int(node) < self.N:
            return {"added": False, "error": "unknown junction"}
        day, hour = self._clip_time(day, hour)
        before = self._live(day, hour).p_location[int(node)]
        self.record("test", day, hour, node=int(node), failed=bool(failed),
                    value=None if value is None else round(float(value), 2))
        return {"added": True, "p_before": float(before), "p_after": float(self._live(day, hour).p_location[int(node)])}

    # ----------------------------------------------------------- escalation
    def alert_action(self, action: str, actor: str, day: int, hour: int, note: str = "") -> dict:
        day, hour = self._clip_time(day, hour)
        now = self.now(day, hour)
        alert, _, _ = self._rebuild(now)
        if alert is None:
            return {"ok": False, "error": "no alert at this time"}
        allowed = {"acknowledge": alert.status == "open" and alert.stage_index == 0,
                   "samples": alert.status == "open" and alert.stage_index == 1,
                   "confirm": alert.status == "open" and alert.stage_index == 2,
                   "clear": alert.status == "open" and alert.stage_index == 2,
                   "approve_work_order": alert.status == "confirmed",
                   "approve_advisory": alert.status == "confirmed"}
        if not allowed.get(action):
            return {"ok": False, "error": f"'{action}' is not available at this stage"}
        self.record("stage", day, hour, action=action, actor=actor, note=note.strip()[:200])
        return {"ok": True}

    # ----------------------------------------------------------- audit
    def audit(self, day: int, hour: int) -> dict:
        _, _, log = self._rebuild(self.now(day, hour))
        ok, bad = log.verify()
        return {"ok": ok, "bad": bad, "rows": [{**r, "payload": json.loads(r["payload"])} for r in log.rows()]}

    def tamper_test(self, day: int, hour: int, seq: int = 1) -> dict:
        _, _, log = self._rebuild(self.now(day, hour))
        log.db.execute("UPDATE audit SET payload = payload || ' ' WHERE seq = ?", (seq,))
        ok, bad = log.verify()
        return {"ok": ok, "broken_at": bad, "rows": len(log.rows())}

    def export_pack(self, day: int, hour: int) -> dict:
        """Printable pack for the drafts: alert ID, audit head hash, SIMULATED watermark."""
        alert, _, log = self._rebuild(self.now(day, hour))
        rows = log.rows()
        post = self._live(*self._clip_time(day, hour))
        return {"alert": alert.id if alert else None,
                "exposed_people": self.exposed_people([int(i) for i in post.credible_set(0.9)]),
                "day": int(day), "hour": int(hour), "work_order": alert.work_order if alert else None,
                "advisory": alert.advisory if alert else None, "audit_head": rows[-1]["hash"] if rows else None,
                "generated": self.now(day, hour).isoformat(),
                "digest": hashlib.sha256(json.dumps([r["hash"] for r in rows]).encode()).hexdigest()[:16]}

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
                "net3": {**json.loads((ROOT / "results/summary_net3.json").read_text())["detection"]["quarterly"],
                         "top3": json.loads((ROOT / "results/summary_net3.json").read_text())["localisation"]["main"]["top3@3:F"][0]}}
