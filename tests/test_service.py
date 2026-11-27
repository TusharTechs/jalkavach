"""Web-service guarantees: state is a pure function of (day, hour, recorded actions)."""
import pytest

from jalkavach.service import EVAL_HOUR, Service


@pytest.fixture(scope="module")
def svc():
    return Service()


def test_get_requests_have_no_side_effects(svc):
    svc.reset()
    a = svc.day_state(12, 20)
    b = svc.day_state(12, 20)
    assert a == b
    assert svc.actions == []


def test_scrubbing_back_and_forth_is_consistent(svc):
    svc.reset()
    late = svc.audit(18, 20)
    svc.day_state(4, 10)
    again = svc.audit(18, 20)
    assert [r["hash"] for r in late["rows"]] == [r["hash"] for r in again["rows"]]
    early = svc.audit(4, 10)
    assert len(early["rows"]) <= len(late["rows"])


def test_alert_opens_at_eval_hour_and_audit_is_chronological(svc):
    svc.reset()
    d = svc.first_alarm_day(svc.D - 1)
    assert d is not None
    assert svc.day_state(d, EVAL_HOUR - 1)["status"] == "NORMAL"
    assert svc.day_state(d, EVAL_HOUR)["status"] == "ALERT"
    rows = svc.audit(svc.D - 1, 23)["rows"]
    stamps = [r["ts"] for r in rows]
    assert stamps == sorted(stamps)


def test_acknowledging_in_time_stops_escalation(svc):
    svc.reset()
    d = svc.first_alarm_day(svc.D - 1)
    assert svc.alert_action("acknowledge", "AE", d, EVAL_HOUR + 2)["ok"]
    st = svc.day_state(d + 1, 12)["escalation"]
    assert st["stage_index"] == 1 and st["overdue_h"] == 0
    rows = svc.audit(d + 1, 12)["rows"]
    done = [r for r in rows if r["action"] == "stage_done:acknowledge"]
    assert done and done[0]["payload"]["on_time"]
    assert not [r for r in rows if r["action"] == "escalated"]


def test_actions_before_their_time_are_not_applied(svc):
    svc.reset()
    d = svc.first_alarm_day(svc.D - 1)
    svc.alert_action("acknowledge", "AE", d, EVAL_HOUR + 3)
    st = svc.day_state(d, EVAL_HOUR + 1)["escalation"]     # scrub to before the acknowledgement
    assert st["stage_index"] == 0
    svc.reset()


def test_complaint_moves_posterior_and_is_audited(svc):
    svc.reset()
    d = svc.first_alarm_day(svc.D - 1)
    r = svc.add_complaint("पानी की टंकी के पास पानी गंदा आ रहा है, बदबू भी है", d, EVAL_HOUR + 1)
    assert r["added"] and r["p_after"] > r["p_before"]
    acts = [x["action"] for x in svc.audit(d, EVAL_HOUR + 2)["rows"]]
    assert "complaint_added" in acts
    svc.reset()


def test_late_evidence_never_changes_an_earlier_evaluation(svc):
    """A complaint at 23:00 must not open (or move) the alert decided at 18:00 that day."""
    svc.reset()
    d = svc.first_alarm_day(svc.D - 1)
    before = svc.day_state(d - 1, 21)
    for _ in range(6):
        svc.add_complaint("पानी की टंकी के पास पानी गंदा आ रहा है, बदबू भी है", d - 1, 23)
    after = svc.day_state(d - 1, 21)
    assert before["status"] == after["status"] == "NORMAL"
    assert before["p_event"] == after["p_event"]
    assert svc.first_alarm_day(d - 1) is None                             # still no alert before day d
    rows = svc.audit(svc.D - 1, 23)["rows"]
    assert [r["ts"] for r in rows] == sorted(r["ts"] for r in rows)
    svc.reset()


def test_ambiguous_landmark_must_be_chosen(svc):
    svc.reset()
    d = svc.first_alarm_day(svc.D - 1)
    text = "स्कूल के पास पानी गंदा है, बदबू भी है"
    r = svc.add_complaint(text, d, EVAL_HOUR + 1)
    assert not r["added"] and r["parsed"]["ambiguous"] and len(r["parsed"]["options"]) > 1
    pick = r["parsed"]["options"][1]["node"]
    r2 = svc.add_complaint(text, d, EVAL_HOUR + 1, node=pick)
    assert r2["added"] and r2["parsed"]["node"] == pick
    assert r2["parsed"]["place_match"] == r["parsed"]["options"][1]["name"]
    assert not svc.add_complaint(text, d, EVAL_HOUR + 1, node=10**6)["added"]
    svc.reset()


def test_each_stage_has_its_own_ladder_and_due_moment_is_not_overdue(svc):
    svc.reset()
    d = svc.first_alarm_day(svc.D - 1)
    sla0 = svc.meta_info()["policy"]["stages"][0]["sla_hours"]
    due = d * 24 + EVAL_HOUR + sla0
    rows = svc.audit(due // 24, due % 24)["rows"]
    assert not [r for r in rows if r["action"] == "escalated"]          # the owner still has the clock
    late = due + 2
    svc.alert_action("acknowledge", "AE", late // 24, late % 24, note="road blocked by a wedding procession")
    rows = svc.audit(late // 24, late % 24)["rows"]
    esc = [r for r in rows if r["action"] == "escalated"]
    done = [r for r in rows if r["action"] == "stage_done:acknowledge"][0]
    assert len(esc) == 1 and not done["payload"]["on_time"]
    assert done["payload"]["reason_for_delay"].startswith("road blocked")
    st = svc.day_state(late // 24, late % 24)["escalation"]
    assert st["stage_index"] == 1 and st["escalated_to"] == []           # stage 2 starts a fresh ladder
    svc.reset()


def test_inputs_are_validated(svc):
    svc.reset()
    assert not svc.add_test(10**6, 9, 18, True, 0.1)["added"]
    assert svc.day_state(999, 99)["day"] == svc.D - 1
    svc.reset()


def test_exposure_is_reported_on_alert(svc):
    svc.reset()
    d = svc.first_alarm_day(svc.D - 1)
    st = svc.day_state(d, EVAL_HOUR)
    assert 0 < st["exposed_people"] <= float(svc.ctx.pop.sum()) + 10
    assert svc.export_pack(d, EVAL_HOUR)["exposed_people"] == st["exposed_people"]
