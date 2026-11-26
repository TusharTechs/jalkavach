"""Day-1 engine tests: physics sanity, trace tensor, posterior identifiability."""
import numpy as np
import wntr

from jalkavach import hydraulics as H
from jalkavach.network import load_benchmark
from jalkavach.posterior import compute_posterior
from jalkavach.signals import expected_observations, simulate


def test_ward_network_is_built_from_osm(demo):
    _, ward, _ = demo
    assert len(ward.junctions) > 50
    assert ward.provenance["streets"].startswith("OpenStreetMap")
    assert "synthetic" in ward.provenance["pipes"]


def test_intermittent_hydraulics_are_physical(demo):
    _, ward, _ = demo
    h = H.run_hydraulics(ward.wn, ward.junctions)
    H.check_hydraulics(h, min_pressure_m=-1.0)      # no negative pressures, no unbalanced
    hrs = h.pressure.index / 3600
    on = h.pressure[(hrs >= 6) & (hrs < 8)].to_numpy()
    off = h.pressure[(hrs >= 10) & (hrs < 16)].to_numpy()
    assert on.mean() > off.mean(), "supply windows must raise pressure"


def test_pressure_deficit_has_contrast(demo):
    _, ward, _ = demo
    h = H.run_hydraulics(ward.wn, ward.junctions)
    d = H.pressure_deficit(h, 10.0)
    assert d.std() > 1.0
    assert (H.pressure_deficit(h, 15.0) >= d - 1e-9).all()   # monotone in threshold


def test_trace_tensor_properties(demo):
    ctx, _, _ = demo
    R = ctx.R
    assert R.min() >= 0 and R.max() <= 1
    assert np.allclose(np.diag(R), 1.0, atol=0.05)           # a node always sees its own ingress
    assert np.median((R > 0.05).sum(axis=1)) >= 2            # ingress travels downstream


def test_chlorine_baseline_decays(demo):
    ctx, _, _ = demo
    assert 0.0 < ctx.cl_base.min() < ctx.cl_base.max() <= 0.5 + 1e-6


def test_noise_free_evidence_localises_true_segment(demo):
    ctx, _, _ = demo
    C = ctx.R.shape[0]
    uniform = np.full(C, 1.0 / C)
    hits = 0
    for c in range(C):
        obs = expected_observations(ctx, {"c": c, "t0": 5, "intensity": 0.4})
        post = compute_posterior(ctx, obs, today=12, use=("complaints",), prior=uniform)
        hits += c in post.top_k(3)
    assert hits / C >= 0.95


def test_no_event_stays_below_alarm(demo):
    ctx, _, _ = demo
    post = compute_posterior(ctx, expected_observations(ctx, None), today=12)
    assert post.p_event < 0.05


def test_simulated_event_is_detected(demo, rng):
    ctx, _, _ = demo
    detected = 0
    # events whose plume reaches >= 200 residents; dead-end ingress reaching a few dozen people
    # produces too few complaints to detect (a stated limitation)
    reach = (ctx.R * ctx.pop[None, :]).sum(axis=1)
    big = np.where(reach >= 200)[0]
    w = ctx.prior[big] / ctx.prior[big].sum()
    for _ in range(10):
        c = int(rng.choice(big, p=w))
        obs = simulate(ctx, {"c": c, "t0": 4, "intensity": 0.4}, rng)
        # 5x the prior event probability (0.02); the live alarm uses a stricter calibrated threshold
        detected += compute_posterior(ctx, obs, today=12).p_event > 0.1
    assert detected >= 8


def test_failed_field_test_raises_local_posterior(demo):
    ctx, _, _ = demo
    C = ctx.R.shape[0]
    c = int(np.argmax((ctx.R > 0.05).sum(axis=1)))            # a well-connected source
    downstream = int(np.argsort(-ctx.R[c])[1])
    base = expected_observations(ctx, None)
    from jalkavach.signals import FieldTest
    base.tests = [FieldTest(day=10, node=downstream, failed=True, kind="h2s")]
    post = compute_posterior(ctx, base, today=12, use=("tests",), prior=np.full(C, 1 / C))
    explains = ctx.R[:, downstream] > 0.05
    # one positive H2S test (5% false-positive rate) should up-weight every candidate that
    # can reach the sampled tap by >10x relative to candidates that cannot
    assert post.p_location[explains].mean() > 10 * post.p_location[~explains].mean()


def test_engine_runs_on_benchmark_net3():
    wn = load_benchmark("Net3")
    wn.options.time.duration = 6 * 3600
    juncs = wn.junction_name_list[:5]
    R = H.trace_tensor(wn, juncs, wn.junction_name_list)
    assert R.shape == (5, len(wn.junction_name_list))
    assert np.isfinite(R).all()
