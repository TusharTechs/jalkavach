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
