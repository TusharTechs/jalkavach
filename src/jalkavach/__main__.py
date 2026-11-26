"""`python -m jalkavach`: run one demo scenario offline and print the alert."""
from __future__ import annotations

import numpy as np

from .context import build_context
from .posterior import compute_posterior
from .demo import _alert_threshold
from .signals import simulate


def main() -> None:
    ctx, ward, _ = build_context("demo_ward", offline=True)
    rng = np.random.default_rng(2036)
    c = int(np.argmax(ctx.prior))
    event = {"c": c, "t0": 6, "intensity": 0.15}
    tests = [(10, int(np.argsort(-ctx.R[c])[1]), "chlorine")]
    obs = simulate(ctx, event, rng, tests)
    print(f"{ward.cfg['label']}: {len(ward.junctions)} nodes, {len(ward.pipes)} pipes")
    for k, v in ward.provenance.items():
        print(f"  {k:12s} {v}")
    thr = _alert_threshold()
    print(f"\nalert threshold P(event) >= {thr:.4f} (calibrated: <=1 false alarm per ward per quarter)")
    print("day  P(event)  top-3 candidate nodes")
    for today in range(4, ctx.params.days):
        post = compute_posterior(ctx, obs, today=today)
        flag = "  <- ALERT" if post.p_event >= thr else ""
        print(f"{today:3d}  {post.p_event:8.3f}  {[ward.junctions[i] for i in post.top_k(3)]}{flag}")
    print(f"\n(simulated scenario: true ingress node {ward.junctions[c]}, onset day {event['t0']})")


if __name__ == "__main__":
    main()
