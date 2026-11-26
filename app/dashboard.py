"""JalKavach dashboard (Streamlit). Runs fully offline.

    uv run streamlit run app/dashboard.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pydeck as pdk
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from jalkavach.context import build_context  # noqa: E402
from jalkavach.escalation import AuditLog, EscalationEngine  # noqa: E402
from jalkavach.intake import Gazetteer, process_text  # noqa: E402
from jalkavach.kitreader import DPD_SCALE, read_photo, simulate_photo  # noqa: E402
from jalkavach.posterior import combine, loglik_terms  # noqa: E402
from jalkavach.routing import expected_information_gain  # noqa: E402
from jalkavach.signals import FieldTest, Observations  # noqa: E402

st.set_page_config(page_title="JalKavach", page_icon="💧", layout="wide")
BASE_DATE = datetime(2026, 12, 1)


# ------------------------------------------------------------------ loading
@st.cache_resource
def load():
    ctx, ward, meta = build_context("demo_ward", offline=True)
    replay = json.loads((ROOT / "data/demo/replay.json").read_text())
    gaz = Gazetteer.load(ward)
    pois = json.loads((ROOT / "data/cache/pois_demo_ward.json").read_text())
    summary = json.loads((ROOT / "results/summary_ward.json").read_text())
    clips = json.loads((ROOT / "data/demo/clips/clips.json").read_text())
    tr_path = ROOT / "data/cache/transcripts.json"
    transcripts = json.loads(tr_path.read_text()) if tr_path.exists() else {}
    return ctx, ward, meta, replay, gaz, pois, summary, clips, transcripts


ctx, ward, meta, replay, gaz, pois, summary, clips, transcripts = load()
N = len(ctx.pop)
nodes = replay["nodes"]
LAT = np.array([n["lat"] for n in nodes])
LON = np.array([n["lon"] for n in nodes])
THR = replay["alert_threshold"]


def poi_display(p: dict) -> str:
    # never show colony names on screen; label by landmark type instead
    if "bhagirathpura" in p["name"].lower():
        return "Govt. school"
    return p["name"]


def node_label(i: int) -> str:
    best, bd = None, 1e9
    for p in pois:
        d = ((LAT[i] - p["lat"]) * 111_000) ** 2 + ((LON[i] - p["lon"]) * 102_000) ** 2
        if d < bd:
            best, bd = p, d
    if best is not None and bd ** 0.5 < 150:
        return f"Segment {i} · near {poi_display(best)}"
    return f"Segment {i}"


# ------------------------------------------------------------------ session
ss = st.session_state
ss.setdefault("extra_complaints", [])     # (node, day)
ss.setdefault("extra_tests", [])          # (day, node, failed, kind)
ss.setdefault("log", AuditLog())
ss.setdefault("engine", EscalationEngine(ss.log))
ss.setdefault("alert", None)


def observations(today: int) -> Observations:
    o = replay["obs"]
    C = np.zeros((o["n_nodes"], o["days"]), dtype=int)
    for n, d, c in o["complaints"]:
        C[n, d] += c
    for n, d in ss.extra_complaints:
        C[n, d] += 1
    tests = [FieldTest(d, n, f, k) for d, n, f, k in o["tests"]]
    tests += [FieldTest(d, n, f, k) for d, n, f, k in ss.extra_tests]
    return Observations(complaints=C, syndromic=np.array(o["syndromic"]),
                        hospital=np.array(o["hospital"]), tests=[t for t in tests if t.day <= today])


def posterior(today: int):
    return combine(ctx, loglik_terms(ctx, observations(today), today))


def alert_index(p: float) -> float:
    lo = lambda x: np.log(max(x, 1e-12) / max(1 - x, 1e-12))  # noqa: E731
    return float(100 / (1 + np.exp(-(lo(p) - lo(THR)))))


# ------------------------------------------------------------------ sidebar
with st.sidebar:
    st.title("💧 JalKavach")
    st.caption("Early warning for sewage ingress in intermittent water networks")
    st.warning("**Simulated scenario.** Not a real event, not real utility data.", icon="⚠️")
    today = st.slider("Day", 2, replay["obs"]["days"] - 1, replay["alarm_day"] + 2)
    hour = st.slider("Hour of day", 0, 23, 17)
    now = BASE_DATE + timedelta(days=today, hours=hour)
    st.caption(f"Clock: {now:%a %d %b, %H:%M}")
    st.divider()
    st.markdown("**Data provenance**")
    for k, v in replay["provenance"].items():
        if k == "source_node":
            continue
        badge = "🟢 real" if "real" in v.lower() or "api" in v.lower() else "🟠 synthetic"
        st.markdown(f"- {k}: {badge}  \n  <small>{v}</small>", unsafe_allow_html=True)
    st.markdown("- complaints, tests, pharmacy: 🟠 synthetic (simulated scenario)")
    with st.expander("Model card"):
        st.markdown(
            "- **What it does:** ranks the most likely ingress locations and raises a calibrated alert.\n"
            "- **No alert ≠ safe.** Field tests remain the ground truth.\n"
            f"- **Alert threshold:** calibrated to {summary['thresholds'] and '≤1 false alarm per ward per quarter'} on held-out no-event scenarios.\n"
            "- **Drafts only:** work orders and advisories need human approval. The advisory needs the Health Officer's approval.\n"
            "- **Known weaknesses:** lower detection where people report less; coarse geocoding hurts localisation. See Results.")

post = posterior(today)
ai = alert_index(post.p_event)
alerting = post.p_event >= THR
status = "ALERT" if alerting else ("WATCH" if ai > 35 else "NORMAL")

# open the alert automatically the first time the threshold is crossed
if alerting and ss.alert is None:
    first = next(d for d in range(2, today + 1) if posterior(d).p_event >= THR)
    p_first = posterior(first)
    cands = [{"node": int(i), "p": float(p_first.p_location[i]), "label": node_label(int(i))}
             for i in p_first.top_k(3)]
    ss.alert = ss.engine.open_alert(f"JK-{first:02d}-W1", "Demo ward", BASE_DATE + timedelta(days=first, hours=9),
                                    p_first.p_event, cands, {k: round(v, 2) for k, v in p_first.contributions.items()})
if ss.alert is not None:
    ss.engine.tick(ss.alert, now)

# ------------------------------------------------------------------ header
c1, c2, c3, c4 = st.columns([1.1, 1, 1.4, 2])
colour = {"ALERT": "#d62728", "WATCH": "#ff7f0e", "NORMAL": "#2ca02c"}[status]
c1.markdown(f"<div style='font-size:13px;color:grey'>Ward status, day {today}</div>"
            f"<div style='font-size:32px;font-weight:700;color:{colour}'>{status}</div>", unsafe_allow_html=True)
c2.metric("Alert index", f"{ai:.0f}", help="50 = alert threshold, calibrated to ≤1 false alarm per ward per quarter")
if ss.alert is not None:
    s = ss.engine.status(ss.alert, now)
    if s["owner"]:
        clock = (f"⏱ {s['remaining_h']:.0f} h left" if s["overdue_h"] == 0 else f"🔴 overdue {s['overdue_h']:.0f} h")
        c3.markdown(f"**{s['stage']}**  \nOwner: {s['owner']}  \n{clock}")
    else:
        c3.markdown(f"**Alert {s['stage']}**")
    if s["escalated_to"]:
        c4.markdown("**Escalated to:** " + " → ".join(s["escalated_to"]))
    else:
        c4.markdown(f"Alert **{ss.alert.id}** opened {ss.alert.opened:%d %b %H:%M}. Notified: DSO (IDSP)")
else:
    c3.markdown("No open alert")

tab_map, tab_alert, tab_intake, tab_results, tab_audit = st.tabs(
    ["🗺️ Ward map", "🚨 Alert & escalation", "📥 Complaint & field-test intake", "📊 Results", "🔏 Audit log"])

# ------------------------------------------------------------------ map
with tab_map:
    left, right = st.columns([2.2, 1])
    p = post.p_location * (1.0 if alerting else 0.25)
    pmax = max(post.p_location.max(), 1e-9)
    pipes_data = []
    for e in replay["pipes"]:
        heat = (post.p_location[e["a"]] + post.p_location[e["b"]]) / 2 / pmax
        pipes_data.append({"path": [[LON[e["a"]], LAT[e["a"]]], [LON[e["b"]], LAT[e["b"]]]],
                           "w": e["diameter_mm"] / 25, "c": [120 + int(135 * heat), 130 - int(100 * heat), 140 - int(110 * heat), 230],
                           "tip": f"Pipe {e['id']} · {e['diameter_mm']} mm · {e['age']} yrs · sewer alongside: {'yes' if e['sewer'] else 'no'}"})
    node_data = [{"pos": [LON[i], LAT[i]], "r": (5 + 45 * (post.p_location[i] / pmax) ** 0.7) if alerting else 4,
                  "tip": f"{node_label(i)}<br/>P(ingress here | event) = {post.p_location[i]:.1%}"} for i in range(N)]
    obs = observations(today)
    recent = obs.complaints[:, max(0, today - 2):today + 1].sum(axis=1)
    comp_data = [{"pos": [LON[i], LAT[i]], "r": 8 + 5 * int(recent[i]),
                  "tip": f"{int(recent[i])} complaint(s) in the last 3 days, geocoded here"} for i in np.where(recent > 0)[0]]
    test_data = [{"pos": [LON[t.node], LAT[t.node]], "c": [214, 39, 40] if t.failed else [44, 160, 44],
                  "tip": f"Field test day {t.day}: {'FAILED (<0.2 mg/L)' if t.failed else 'passed'}"}
                 for t in obs.tests if today - 3 <= t.day <= today]
    sugg = []
    if alerting:
        eig = expected_information_gain(ctx, post, min(today + 1, replay["obs"]["days"] - 1))
        sugg = [int(i) for i in np.argsort(-eig)[:2]]
    sug_data = [{"pos": [LON[i], LAT[i]], "tip": f"Suggested next test: {node_label(i)}"} for i in sugg]
    top = post.top_k(3) if alerting else []
    offs = [[-16, -16], [16, -16], [0, 18]]
    lab_data = [{"pos": [LON[i], LAT[i]], "t": str(k + 1), "o": offs[k]} for k, i in enumerate(top)]
    ph = [{"pos": [q["lon"], q["lat"]], "tip": f"{poi_display(q)} (pharmacy partner: aggregate ORS counts)"}
          for q in pois if any(w in q["name"].lower() for w in ("medical", "medicose"))]
    layers = [
        pdk.Layer("PathLayer", pipes_data, get_path="path", get_width="w", width_min_pixels=2,
                  get_color="c", pickable=True),
        pdk.Layer("ScatterplotLayer", node_data, get_position="pos", get_radius="r", radius_min_pixels=3,
                  get_fill_color=[214, 39, 40, 150], pickable=True),
        pdk.Layer("ScatterplotLayer", ph, get_position="pos", get_radius=7, radius_min_pixels=3,
                  get_fill_color=[148, 103, 189, 220], pickable=True),
        pdk.Layer("ScatterplotLayer", comp_data, get_position="pos", get_radius="r", radius_min_pixels=4,
                  get_fill_color=[255, 127, 14, 200], pickable=True),
        pdk.Layer("ScatterplotLayer", test_data, get_position="pos", get_radius=10, radius_min_pixels=5,
                  get_fill_color="c", get_line_color=[0, 0, 0], stroked=True, line_width_min_pixels=1, pickable=True),
        pdk.Layer("ScatterplotLayer", sug_data, get_position="pos", get_radius=22, radius_min_pixels=9,
                  filled=False, stroked=True, get_line_color=[31, 119, 180], line_width_min_pixels=3, pickable=True),
        pdk.Layer("TextLayer", lab_data, get_position="pos", get_text="t", get_size=22, get_color=[0, 0, 0],
                  get_pixel_offset="o", background=True, get_background_color=[255, 255, 255, 220]),
    ]
    view = pdk.ViewState(latitude=float(LAT.mean()), longitude=float(LON.mean()), zoom=15.6)
    left.pydeck_chart(pdk.Deck(layers=layers, initial_view_state=view, map_style=None,
                               tooltip={"html": "{tip}"}), height=560)
    left.caption("🟠 complaints (last 3 days) · 🟢/🔴 field tests · 🟣 partner pharmacies · 🔵 ring = suggested next test · "
                 "1-2-3 = most likely ingress segments. Streets: OpenStreetMap. Pipes: synthetic.")
    with right:
        st.subheader("Most likely ingress segments")
        if alerting:
            for k, i in enumerate(top):
                st.markdown(f"**{k + 1}. {node_label(int(i))}**: {post.p_location[i]:.0%}")
            st.subheader("Why here? Evidence vs. 'no event'")
            for sig, v in post.contributions.items():
                st.progress(min(1.0, max(0.0, v / 30)), text=f"{sig}: {v:+.1f} log-likelihood")
            st.subheader("Suggested next field tests")
            for i in sugg:
                st.markdown(f"🔵 {node_label(i)}")
            st.caption("Chosen to narrow down the likely segment fastest (expected information gain).")
        else:
            st.info("No alert. Signals are within normal variation. (No alert does not mean safe.)")
        st.divider()
        o = replay["obs"]
        st.markdown("**Ward signals so far**")
        st.line_chart({"complaints/day": obs.complaints.sum(axis=0)[: today + 1],
                       "pharmacy ORS units/day": np.array(o["syndromic"][: today + 1])}, height=180)

# ------------------------------------------------------------------ alert
with tab_alert:
    a = ss.alert
    if a is None:
        st.info("No alert yet. Move the day slider forward.")
    else:
        eng = ss.engine
        st.markdown(f"### Alert {a.id}. Opened {a.opened:%d %b %H:%M}. Status: **{a.status}**")
        st.caption("The city sets owners, SLAs and the escalation chain (configs/escalation.yaml). JalKavach runs the clock and keeps the record.")
        cols = st.columns(len(eng.stages))
        for k, (col, stg) in enumerate(zip(cols, eng.stages)):
            done = k < a.stage_index or a.status != "open"
            col.markdown(f"{'✅' if done else ('⏳' if k == a.stage_index else '⬜')} **{stg['label']}**  \n"
                         f"{stg['owner']}  \nSLA {stg['sla_hours']} h")
        if a.status == "open":
            actor = st.selectbox("Acting as", [s["owner"] for s in eng.stages])
            b1, b2, b3 = st.columns(3)
            if a.stage_index == 0 and b1.button("Acknowledge"):
                eng.complete_stage(a, actor, now, "acknowledged")
                st.rerun()
            if a.stage_index == 1 and b1.button("Field tests taken"):
                eng.complete_stage(a, actor, now, "samples recorded", {"tests": len(ss.extra_tests)})
                st.rerun()
            if a.stage_index == 2:
                if b1.button("Confirm ingress → draft work order & advisory"):
                    a.candidates = [{"node": int(i), "p": float(post.p_location[i]), "label": node_label(int(i))}
                                    for i in post.top_k(3)]          # ranking at confirmation time
                    eng.confirm(a, actor, now, [c["label"] for c in a.candidates])
                    st.rerun()
                if b2.button("Clear (false alarm)"):
                    eng.clear(a, actor, now, "field tests normal")
                    st.rerun()
        if a.work_order:
            w1, w2 = st.columns(2)
            w1.text_area("Draft work order", a.work_order, height=230)
            if w1.button("Approve work order (Executive Engineer)"):
                eng.approve(a, "work_order", "Executive Engineer, Water Works (zone)", now)
            w2.text_area("Draft boil-water advisory (Hindi + English)", a.advisory, height=230)
            if w2.button("Approve advisory (Health Officer)"):
                eng.approve(a, "advisory", eng.policy["advisory_approver"], now)
            st.caption("JalKavach never sends messages itself. Approval is recorded, and the officer sends through official channels.")

# ------------------------------------------------------------------ intake
with tab_intake:
    st.subheader("Citizen complaint (voice or text)")
    st.caption("Hindi speech recognition runs locally (faster-whisper). Extraction and geocoding run offline. The demo clips are synthetic voices.")
    cl, cr = st.columns(2)
    with cl:
        clip = st.selectbox("Demo voice note", clips, format_func=lambda c: f"{c['id']}: {c['en'][:60]}…")
        st.audio(str(ROOT / f"data/demo/clips/{clip['id']}.wav"))
        cached = [v["text"] for v in transcripts.values() if v.get("file") == f"{clip['id']}.wav"]
        text = st.text_area("Transcript (editable)", cached[0] if cached else clip["text"], height=90)
        st.caption(f"English: {clip['en']}")
    with cr:
        comp = process_text(text, gaz)
        st.json({"water-quality complaint": comp.water_quality, "colour": comp.colour, "odour": comp.odour,
                 "symptoms": comp.symptoms, "place heard": comp.place_text,
                 "matched landmark": comp.place_match and ("Govt. school" if "bhagirathpura" in comp.place_match.lower() else comp.place_match),
                 "match score": round(comp.match_score), "geocoded to": node_label(comp.node) if comp.node is not None else None,
                 "radius (m)": comp.radius_m})
        if comp.node is not None and comp.water_quality and st.button(f"Add complaint to evidence (day {today})"):
            ss.extra_complaints.append((comp.node, today))
            ss.log.append(now, "Citizen (311 voice)", "complaint_added", ss.alert.id if ss.alert else "-",
                          {"node": comp.node, "colour": comp.colour, "odour": comp.odour, "symptoms": comp.symptoms})
            st.rerun()
    st.divider()
    st.subheader("Field test photo (kit reader, screening only)")
    k1, k2 = st.columns(2)
    with k1:
        up = st.file_uploader("Photo of the field card with the sample", type=["jpg", "jpeg", "png"])
        if st.button("Use demo photo: labelled 'demo sample, dechlorinated'"):
            rng = np.random.default_rng(today)
            ss.demo_photo = simulate_photo(DPD_SCALE[1][1], rng)
        import cv2
        img = None
        if up is not None:
            img = cv2.imdecode(np.frombuffer(up.read(), np.uint8), cv2.IMREAD_COLOR)
        elif "demo_photo" in ss:
            img = ss.demo_photo
        if img is not None:
            st.image(img[:, :, ::-1], caption="Field card photo", use_container_width=True)
    with k2:
        if img is not None:
            r = read_photo(img)
            if not r.ok:
                st.warning(r.message)
            elif r.below_threshold:
                st.error(r.message)
            else:
                st.success(r.message)
            if r.ok:
                default = sugg[0] if sugg else 0
                where = st.selectbox("Tap where the sample was taken", list(range(N)), index=default, format_func=node_label)
                if st.button(f"Add field test to evidence (day {today})"):
                    ss.extra_tests.append((today, int(where), bool(r.below_threshold), "chlorine"))
                    ss.log.append(now, "Amrut Mitra field team", "field_test_added", ss.alert.id if ss.alert else "-",
                                  {"node": int(where), "mg_l": round(r.value_mg_l, 2), "below_0_2": r.below_threshold})
                    st.rerun()
        st.caption("Get the printable card from data/field_card_v0.1.png. The colour patches must be replaced with the actual kit's scale and validated against a lab colorimeter.")

# ------------------------------------------------------------------ results
with tab_results:
    q = summary["detection"]["quarterly"]
    loc = summary["localisation"]["main"]
    st.subheader("Evaluation on held-out simulated scenarios (pre-registered)")
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Lead over hospital-only baseline", f"{q['lead_F_vs_H'][0]:.0f} days",
              help=f"Median, 95% CI {q['lead_F_vs_H'][1]:.0f}–{q['lead_F_vs_H'][2]:.0f}")
    m2.metric("Events detected (21 days)", f"{q['F']['detected'][0]:.0%}")
    m2.caption(f"Hospital-only baseline: {q['H']['detected'][0]:.0%}")
    m3.metric("True segment in top 3 (alert + 3 days)", f"{loc['top3@3:F'][0]:.0%}")
    m3.caption(f"Complaint-centroid baseline: {loc['top3@3:CC'][0]:.0%}")
    m4.metric("90% credible set coverage", f"{loc['coverage90:F'][0]:.0%}")
    st.caption("All at ≤1 false alarm per ward per quarter. Every result is simulated, not field data. Full tables, including the parts that did not work, are in results/RESULTS.md.")
    f1, f2 = st.columns(2)
    f1.image(str(ROOT / "results/figures/detection_cdf_ward.png"))
    f2.image(str(ROOT / "results/figures/tradeoff_ward.png"))
    st.markdown("**What didn't work as well, reported as measured:**")
    st.markdown("- Fusion does not alarm *earlier* than complaints alone. Its gains are in *how many* events are caught and *where*.\n"
                "- The intermittent-supply prior vs. a 24×7 prior: +2.7 pts, not significant.\n"
                "- Detection is lower where people report less (89% vs. 96–98%).")
    st.info(replay["note"])

# ------------------------------------------------------------------ audit
with tab_audit:
    rows = ss.log.rows()
    ok, bad = ss.log.verify()
    if ok:
        st.success(f"Hash chain intact: {len(rows)} entries")
    else:
        st.error(f"Hash chain BROKEN at entry {bad}")
    st.dataframe([{k: r[k] for k in ("seq", "ts", "actor", "action", "payload")} | {"hash": r["hash"][:12] + "…"}
                  for r in rows], use_container_width=True, hide_index=True)
    if st.button("Tamper test: edit entry 1 in a copy, then verify"):
        import sqlite3
        cp = AuditLog()
        cp.db = sqlite3.connect(":memory:")
        ss.log.db.backup(cp.db)
        cp.db.execute("UPDATE audit SET payload = replace(payload, 'p_event', 'p_evnt') WHERE seq = 1")
        ok2, bad2 = cp.verify()
        if not ok2:
            st.error(f"Edited copy: chain broken at entry {bad2}. Any change after the fact is detectable.")
        else:
            st.warning("No entries to tamper with yet.")
    st.caption("The record shows who acted and when. It protects the officers who acted on time.")
