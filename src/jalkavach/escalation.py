"""Escalation engine: the city's own clock, plus a tamper-evident audit trail.

- Every stage has an owner (a designation) and an SLA set by the city
  (configs/escalation.yaml).
- If a stage is overdue, the next designation in the city's chain is notified, every N
  hours.
- JalKavach DRAFTS the work order and the advisory. A human approves and sends them. The
  advisory needs the approval of the officer with legal authority.
- Every action is appended to a hash-chained SQLite log. The log is proof that the
  engineer who acted, acted, and it shows when.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import yaml

from .config import CONFIGS

GENESIS = "0" * 64


# ------------------------------------------------------------------ audit log

class AuditLog:
    def __init__(self, path: str = ":memory:"):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("""CREATE TABLE IF NOT EXISTS audit (
            seq INTEGER PRIMARY KEY, ts TEXT, actor TEXT, action TEXT, alert_id TEXT,
            payload TEXT, prev_hash TEXT, hash TEXT)""")
        self.db.commit()

    @staticmethod
    def _digest(prev: str, ts: str, actor: str, action: str, alert_id: str, payload: str) -> str:
        body = json.dumps([prev, ts, actor, action, alert_id, payload], ensure_ascii=False)
        return hashlib.sha256(body.encode()).hexdigest()

    def append(self, ts: datetime, actor: str, action: str, alert_id: str, payload: dict) -> str:
        row = self.db.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
        prev = row[0] if row else GENESIS
        tss, pl = ts.isoformat(timespec="minutes"), json.dumps(payload, ensure_ascii=False, sort_keys=True)
        h = self._digest(prev, tss, actor, action, alert_id, pl)
        self.db.execute("INSERT INTO audit (ts, actor, action, alert_id, payload, prev_hash, hash) "
                        "VALUES (?,?,?,?,?,?,?)", (tss, actor, action, alert_id, pl, prev, h))
        self.db.commit()
        return h

    def rows(self, alert_id: str | None = None) -> list[dict]:
        q = "SELECT seq, ts, actor, action, alert_id, payload, prev_hash, hash FROM audit"
        args: tuple = ()
        if alert_id:
            q += " WHERE alert_id = ?"
            args = (alert_id,)
        cols = ["seq", "ts", "actor", "action", "alert_id", "payload", "prev_hash", "hash"]
        return [dict(zip(cols, r)) for r in self.db.execute(q + " ORDER BY seq", args)]

    def verify(self) -> tuple[bool, int | None]:
        """Recompute the chain; return (ok, first_bad_seq)."""
        prev = GENESIS
        for r in self.rows():
            if r["prev_hash"] != prev or self._digest(prev, r["ts"], r["actor"], r["action"],
                                                      r["alert_id"], r["payload"]) != r["hash"]:
                return False, r["seq"]
            prev = r["hash"]
        return True, None


# -------------------------------------------------------------------- alerts

@dataclass
class Alert:
    id: str
    ward: str
    opened: datetime
    p_event: float
    candidates: list[dict]                 # [{"node":..., "p":..., "label":...}]
    stage_index: int = 0
    stage_started: datetime | None = None
    status: str = "open"                   # open | confirmed | cleared
    escalated_to: list[str] = field(default_factory=list)
    work_order: str | None = None
    advisory: str | None = None
    opened_label: str = ""                 # e.g. "Day 8, 18:00 (simulation clock)"


class EscalationEngine:
    def __init__(self, log: AuditLog, policy: dict | None = None):
        self.log = log
        self.policy = policy or yaml.safe_load(open(CONFIGS / "escalation.yaml"))
        self.stages = self.policy["stages"]

    # ---- lifecycle
    def open_alert(self, alert_id: str, ward: str, ts: datetime, p_event: float,
                   candidates: list[dict], evidence: dict) -> Alert:
        a = Alert(id=alert_id, ward=ward, opened=ts, p_event=p_event, candidates=candidates,
                  stage_started=ts)
        self.log.append(ts, "JalKavach", "alert_opened", a.id, {
            "ward": ward, "p_event": round(p_event, 4),
            "candidates": [{k: c[k] for k in ("node", "p")} for c in candidates],
            "evidence": evidence, "owner": self.owner(a),
            "notified": self.policy.get("notify_on_open", [])})
        return a

    def owner(self, a: Alert) -> str:
        return self.stages[min(a.stage_index, len(self.stages) - 1)]["owner"]

    def due(self, a: Alert) -> datetime:
        return a.stage_started + timedelta(hours=self.stages[a.stage_index]["sla_hours"])

    def status(self, a: Alert, now: datetime) -> dict:
        if a.status != "open":
            return {"stage": a.status, "owner": None, "due": None, "overdue_h": 0.0,
                    "escalated_to": list(a.escalated_to)}
        due = self.due(a)
        return {"stage": self.stages[a.stage_index]["label"], "owner": self.owner(a), "due": due,
                "overdue_h": max(0.0, (now - due).total_seconds() / 3600),
                "remaining_h": max(0.0, (due - now).total_seconds() / 3600),
                "escalated_to": list(a.escalated_to)}

    def tick(self, a: Alert, now: datetime) -> list[str]:
        """Notify the next designation in the chain for every N overdue hours.

        Each escalation is stamped at the moment it became due (SLA due time + k*N hours),
        not at the moment the clock was checked, so the audit trail shows the true sequence.
        """
        if a.status != "open":
            return []
        due = self.due(a)
        every = self.policy["escalate_every_hours"]
        chain = self.policy["escalation_chain"]
        new = []
        for k, who in enumerate(chain):
            at = due + timedelta(hours=k * every)
            if at >= now:          # at the due moment itself the owner still has the clock
                break
            if who in a.escalated_to:
                continue
            a.escalated_to.append(who)
            new.append(who)
            self.log.append(at, "JalKavach", "escalated", a.id, {
                "to": who, "stage": self.stages[a.stage_index]["id"],
                "overdue_hours": round((at - due).total_seconds() / 3600, 1), "owner": self.owner(a)})
        return new

    def complete_stage(self, a: Alert, actor: str, now: datetime, note: str = "",
                       data: dict | None = None) -> None:
        stage = self.stages[a.stage_index]
        self.log.append(now, actor, f"stage_done:{stage['id']}", a.id,
                        {"note": note, "on_time": now <= self.due(a), **(data or {})})
        if a.stage_index < len(self.stages) - 1:
            a.stage_index += 1
            a.stage_started = now
            a.escalated_to = []    # each stage has its own clock and its own ladder

    def confirm(self, a: Alert, actor: str, now: datetime, node_labels: list[str],
                node_labels_hi: list[str] | None = None) -> None:
        self.complete_stage(a, actor, now, "confirmed")
        a.status = "confirmed"
        a.work_order = draft_work_order(a, node_labels)
        a.advisory = draft_advisory(a, node_labels, node_labels_hi)
        self.log.append(now, actor, "drafts_created", a.id,
                        {"work_order_sha": _sha(a.work_order), "advisory_sha": _sha(a.advisory),
                         "advisory_requires": self.policy["advisory_approver"]})

    def clear(self, a: Alert, actor: str, now: datetime, reason: str) -> None:
        self.complete_stage(a, actor, now, f"cleared: {reason}")
        a.status = "cleared"

    def approve(self, a: Alert, what: str, actor: str, now: datetime) -> None:
        """Record a human approval. JalKavach never sends anything itself."""
        self.log.append(now, actor, f"approved:{what}", a.id, {"sent_by": actor})


def _sha(s: str | None) -> str:
    return hashlib.sha256((s or "").encode()).hexdigest()[:16]


# --------------------------------------------------------------------- drafts

def draft_work_order(a: Alert, node_labels: list[str]) -> str:
    lines = [f"DRAFT WORK ORDER: suspected sewage ingress, {a.ward}",
             f"Alert {a.id}, opened {a.opened_label or f'{a.opened:%d %b %Y %H:%M}'}",
             "Inspect in this order (most likely first):"]
    for i, (c, lab) in enumerate(zip(a.candidates, node_labels), 1):
        lines.append(f"  {i}. {lab}: probability {c['p']:.0%}")
    lines += ["Actions: expose joints near the sewer line, check for leaks and sewer cross-connection,",
              "flush and super-chlorinate after repair, re-test downstream taps.",
              "Generated by JalKavach. Valid only when approved by the Executive Engineer."]
    return "\n".join(lines)


def _group_areas(labels: list[str], hi: bool) -> str:
    """'Lane 143 · 40 m SE of Park 4' x3 -> 'Lanes 143, 125, 142 near Park 4' (how a resident reads it)."""
    groups: dict[str, list[str]] = {}
    loose: list[str] = []
    for lab in labels:
        lane, _, where = lab.partition(" · ")
        if hi:
            mark = where.removesuffix(" के पास").split(" से ")[0]
        else:
            mark = where.removeprefix("at ").rsplit(" of ", 1)[-1]
        num = lane.split()[-1] if lane.split() else lane
        if mark and num.isdigit():
            groups.setdefault(mark, []).append(num)
        else:
            loose.append(lab)
    parts = [(f"{m} के पास गली {', '.join(n)}" if hi else f"{'Lanes' if len(n) > 1 else 'Lane'} {', '.join(n)} near {m}")
             for m, n in groups.items()]
    return "; ".join(parts + loose)


def draft_advisory(a: Alert, area_labels: list[str], area_labels_hi: list[str] | None = None) -> str:
    areas = _group_areas(area_labels[:3], hi=False)
    areas_hi = _group_areas((area_labels_hi or area_labels)[:3], hi=bool(area_labels_hi))
    return (
        f"[ड्राफ़्ट: स्वास्थ्य अधिकारी की स्वीकृति आवश्यक]\n"
        f"[नगर निगम का नाम] · जलप्रदाय विभाग\n"
        f"{areas_hi} क्षेत्र के निवासी कृपया अगली सूचना तक पीने का पानी कम से कम 1 मिनट उबालकर, ठंडा करके पिएँ। "
        f"दस्त/उल्टी होने पर ORS लें व नज़दीकी स्वास्थ्य केंद्र जाएँ। वैकल्पिक जल आपूर्ति: टैंकर ___। "
        f"पानी में बदबू, मटमैलापन या दस्त-उल्टी की शिकायत [शिकायत नंबर] पर दर्ज करें।\n"
        f"[DRAFT: requires Health Officer approval]\n"
        f"[Municipal corporation] · Water Works Department\n"
        f"Residents of {areas}: until further notice, boil drinking water for at least one minute. "
        f"If you have diarrhoea or vomiting, take ORS and visit the nearest health centre. "
        f"Alternative supply: tanker ___. Report smell, discolouration, diarrhoea or vomiting on [complaint number].")
