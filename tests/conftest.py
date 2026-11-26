import numpy as np
import pytest

from jalkavach.context import build_context


@pytest.fixture(scope="session")
def demo():
    ctx, ward, meta = build_context("demo_ward", offline=True)
    return ctx, ward, meta


@pytest.fixture
def rng():
    return np.random.default_rng(1234)
