"""Day-3 tests: escalation + audit log, complaint intake, kit reader, demo replay."""
import json
from datetime import datetime, timedelta

import numpy as np
import pytest

from jalkavach.config import ROOT
from jalkavach.escalation import AuditLog, EscalationEngine
from jalkavach.intake import Gazetteer, extract, process_text
from jalkavach.kitreader import DPD_SCALE, make_card, read_photo, simulate_photo

T0 = datetime(2026, 12, 1, 9)


def _alert(eng):
    return eng.open_alert("A1", "Demo ward", T0, 0.9, [{"node": 1, "p": 0.4, "label": "Seg 1"}], {"complaints": 5.0})


def test_audit_chain_detects_tampering():
    log = AuditLog()
    eng = EscalationEngine(log)
    a = _alert(eng)
    eng.complete_stage(a, "AE", T0 + timedelta(hours=3))
    assert log.verify() == (True, None)
    log.db.execute("UPDATE audit SET actor = 'someone else' WHERE seq = 2")
    ok, bad = log.verify()
    assert not ok and bad == 2


def test_escalation_follows_city_chain_and_clock():
    log = AuditLog()
    eng = EscalationEngine(log)
    every = eng.policy["escalate_every_hours"]
    a = _alert(eng)
    assert eng.tick(a, T0 + timedelta(hours=23)) == []                 # within 24 h SLA
    first = eng.tick(a, T0 + timedelta(hours=25))
    assert first == [eng.policy["escalation_chain"][0]]
    eng.tick(a, T0 + timedelta(hours=24 + 2 * every + 1))              # two more steps due
    assert a.escalated_to == eng.policy["escalation_chain"][:3]
    # each escalation is stamped at the moment it became due, not when the clock was read
    stamps = [r["ts"] for r in log.rows() if r["action"] == "escalated"]
    assert stamps == sorted(stamps) and len(set(stamps)) == 3


def test_confirm_creates_drafts_and_nothing_is_sent():
    log = AuditLog()
    eng = EscalationEngine(log)
    a = _alert(eng)
    for h in (2, 20):
        eng.complete_stage(a, "AE", T0 + timedelta(hours=h))
    eng.confirm(a, "EE", T0 + timedelta(hours=30), ["Seg 1"])
    assert a.status == "confirmed" and "DRAFT" in a.work_order and "स्वास्थ्य अधिकारी" in a.advisory
    actions = [r["action"] for r in log.rows()]
    assert not any("sent" in x for x in actions)                       # approvals only, never sends
    eng.approve(a, "advisory", eng.policy["advisory_approver"], T0 + timedelta(hours=31))
    assert log.rows()[-1]["actor"] == eng.policy["advisory_approver"]


@pytest.mark.parametrize("text,colour,odour,symptoms", [
    ("अरोगे मेदीकल स्थोर के पास नल में पीला पानी आ रहा है, बद्बू भी है।", ["yellow"], ["sewage"], []),
    ("पानी गंडा आ रहा है, बच्छों को दस्थ हो रहे हैं", ["muddy"], [], ["diarrhoea"]),   # ASR variants
    ("ghar mein ulti aur bukhar, pani mein badbu", [], ["sewage"], ["vomiting", "fever"]),
    ("पानी ठीक है, बस प्रेशर कम है", [], [], []),
])
def test_extraction_is_robust_to_asr_spelling(text, colour, odour, symptoms):
    c = extract(text)
    assert c.colour == colour and c.odour == odour and sorted(c.symptoms) == sorted(symptoms)
    assert c.water_quality == bool(colour or odour or symptoms)


def test_demo_clips_geocode_to_their_landmarks(demo):
    _, ward, _ = demo
    gaz = Gazetteer.load(ward)
    clips = json.loads((ROOT / "data/demo/clips/clips.json").read_text())
    trans = json.loads((ROOT / "data/cache/transcripts.json").read_text())
    # clip1 names "the park" in a ward with several parks: it must be flagged, never silently pinned
    expect = {"clip1": "Park*", "clip2": "Water tank", "clip3": "Clinic", "clip4": "Water tank", "clip5": None}
    for c in clips:
        for text in [c["text"]] + [v["text"] for v in trans.values() if v["file"] == f"{c['id']}.wav"]:
            r = process_text(text, gaz)
            want = expect[c["id"]]
            if want is None:
                assert not r.water_quality, (c["id"], text)               # "pressure is low" is rejected
            elif want.endswith("*"):
                assert r.place_match.startswith(want[:-1]) and r.candidates > 1 and len(r.options) > 1, (c["id"], text)
            else:
                assert r.place_match == want and r.candidates == 1, (c["id"], text, r.place_match)
    amb = process_text("स्कूल के पास पानी गंदा है", gaz)                  # 7 schools: flagged ambiguous
    assert amb.candidates > 1 and amb.radius_m >= 250
    assert process_text("रेलवे स्टेशन के पास पानी गंदा है", gaz).node is None   # unknown place: no geocode


def test_kit_reader_screens_against_0_2_mg_l():
    rng = np.random.default_rng(3)
    mg = np.array([m for m, _ in DPD_SCALE])
    rgb = np.array([c for _, c in DPD_SCALE], float)
    correct = 0
    for _ in range(40):
        v = float(rng.uniform(0, 0.8))
        col = tuple(int(np.interp(v, mg, rgb[:, k])) for k in range(3))
        r = read_photo(simulate_photo(col, rng))
        assert r.ok
        correct += r.below_threshold == (v < 0.2) or abs(v - 0.2) < 0.03
    assert correct >= 38


def test_kit_reader_rejects_photo_without_card():
    blank = np.full((600, 800, 3), 128, np.uint8)
    assert not read_photo(blank).ok
    assert make_card().shape == (640, 1000, 3)


def test_demo_replay_is_typical_not_cherry_picked():
    r = json.loads((ROOT / "data/demo/replay.json").read_text())
    med = json.loads((ROOT / "results/summary_ward.json").read_text())["detection"]["quarterly"]["F"]["median_delay"][0]
    assert r["alarm_day"] - r["truth"]["onset_day"] == round(med)         # harness median delay
    truth = r["truth"]["node"]
    day = next(d for d in r["days"] if d["day"] == r["alarm_day"] + 3)
    assert truth in day["top3"]
    alarm = next(d for d in r["days"] if d["day"] == r["alarm_day"])
    assert truth != alarm["top3"][0]                                     # not top-1 at alert time
