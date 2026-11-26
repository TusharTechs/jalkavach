from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIGS = ROOT / "configs"
CACHE = ROOT / "data" / "cache"

PSI_TO_M = 0.70307  # 1 psi of water column in metres


def load_config(name: str = "demo_ward") -> dict:
    path = Path(name)
    if not path.suffix:
        path = CONFIGS / f"{name}.yaml"
    with open(path) as f:
        return yaml.safe_load(f)
