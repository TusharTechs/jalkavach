"""Field-test routing: where should the next kit samples be taken?

info_gain: greedy expected reduction in the entropy of P(location | event), using
           the MAP intensity and onset to predict each candidate test's outcome.
random:    uniformly random taps.
nearest:   taps nearest the complaint-weighted centroid (what a field team would do).
"""
from __future__ import annotations

import numpy as np

from .baselines import complaint_centroid_topk
from .posterior import Posterior
from .signals import WardContext, ramp, test_fail_prob


def _h(p):
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return -(p * np.log(p) + (1 - p) * np.log(1 - p))


def expected_information_gain(ctx: WardContext, post: Posterior, day: int,
                              kind: str = "chlorine") -> np.ndarray:
    pc = post.p_location
    r = ramp(np.array([day - post.map_onset]), ctx.params.ramp_days)[0]
    e = post.map_intensity * ctx.R * r                                 # (C, N)
    pf = test_fail_prob(kind, np.broadcast_to(ctx.cl_base, e.shape), e, ctx.params)
    marginal = (pc[:, None] * pf).sum(axis=0)
    return _h(marginal) - (pc[:, None] * _h(pf)).sum(axis=0)          # mutual information


def choose_tests(policy: str, ctx: WardContext, post: Posterior, complaints: np.ndarray,
                 day: int, k: int, rng: np.random.Generator, exclude: set[int] | None = None) -> list[int]:
    exclude = exclude or set()
    N = len(ctx.pop)
    if policy == "info_gain":
        score = expected_information_gain(ctx, post, day)
    elif policy == "nearest":
        order = complaint_centroid_topk(complaints, ctx.xy, day - 1, window=5, k=N)
        score = np.zeros(N)
        score[order] = -np.arange(N)
    elif policy == "random":
        score = rng.random(N)
    else:
        raise ValueError(policy)
    picks = [int(n) for n in np.argsort(-score) if int(n) not in exclude]
    return picks[:k]
