"""Day-2 tests: baselines, held-out scenario generator, routing, threshold calibration."""
import numpy as np

from jalkavach.baselines import complaint_centroid_topk, ears_c2
from jalkavach.posterior import compute_posterior
from jalkavach.routing import choose_tests, expected_information_gain
from jalkavach.scenario import Scenario, World, sample_gen_params
from jalkavach.signals import expected_observations


def test_ears_flags_spike_not_flat():
    flat = np.full(20, 3.0)
    assert np.nanmax(ears_c2(flat, history_mean=3.0)) < 1.0
    spiked = flat.copy()
    spiked[15] = 15
    assert ears_c2(spiked, history_mean=3.0)[15] > 3.0


def test_complaint_centroid_finds_cluster():
    xy = np.array([[0, 0], [100, 0], [200, 0], [1000, 1000]], dtype=float)
    c = np.zeros((4, 5), dtype=int)
    c[3, 3:] = 4
    assert complaint_centroid_topk(c, xy, today=4, k=1)[0] == 3


def _scenario(ctx, seed, event):
    rng = np.random.default_rng([seed, 1])
    gen = sample_gen_params(ctx, rng)
    return Scenario(ctx, World(ctx.R, ctx.cl_base, "nominal"), gen, event, seed)


def test_scenarios_are_reproducible_and_tests_use_common_random_numbers(demo):
    ctx, _, _ = demo
    ev = {"c": 3, "t0": 5, "intensity": 0.3}
    a, b = _scenario(ctx, 42, ev), _scenario(ctx, 42, ev)
    assert (a.complaints == b.complaints).all()
    assert (a.hospital == b.hospital).all()
    assert a.take_test(8, 3).failed == b.take_test(8, 3).failed


def test_null_scenario_has_no_exposure(demo):
    ctx, _, _ = demo
    sc = _scenario(ctx, 7, None)
    assert sc.e.sum() == 0
    assert np.isnan(sc.exposure_weighted_rho())


def test_information_gain_is_nonnegative_and_targets_the_plume(demo, rng):
    ctx, _, _ = demo
    reach = (ctx.R > 0.05).sum(axis=1)
    c = int(np.argsort(reach)[len(reach) // 2])                 # a mid-network source
    obs = expected_observations(ctx, {"c": c, "t0": 4, "intensity": 0.3})
    post = compute_posterior(ctx, obs, today=6, use=("complaints",))
    eig = expected_information_gain(ctx, post, day=7)
    assert (eig >= -1e-9).all()
    plume = (ctx.R[post.credible_set(0.9)] > 0.05).any(axis=0)
    assert plume[int(np.argmax(eig))], "highest-value test should be inside the likely plume"
    picks = choose_tests("info_gain", ctx, post, np.zeros((len(ctx.pop), 21), int), 10, 2, rng)
    assert len(set(picks)) == 2


def test_calibration_respects_false_alarm_budget():
    from harness.run import calibrate

    rng = np.random.default_rng(0)
    nulls = [{"p_event": {"F": list(rng.random(21) * 0.5)}} for _ in range(200)]
    thr = calibrate(nulls, "F", 1.0, False)
    p_any = np.mean([max(r["p_event"]["F"][2:]) >= thr for r in nulls])
    assert p_any * 90 / 21 <= 1.0 + 1e-9
