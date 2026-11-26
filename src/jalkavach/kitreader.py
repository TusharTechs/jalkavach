"""Field-test photo reader (screening only).

A printed reference card carries:
- 4 ArUco markers at the corners, used to rectify the photo;
- a white patch, used for white balance;
- printed colour patches copied from the kit's own comparator scale;
- a window where the field team places the tube or strip.

The reader rectifies the card, white-balances on the white patch, and compares the
sample colour with the printed patches in CIE-LAB. The patches sit under the same light
as the sample, so colour casts largely cancel. The output is a binary screen against the
IS 10500 residual-chlorine minimum (0.2 mg/L), with a margin. H2S vials are read by
darkening (black precipitate = positive).

The patch colours below approximate a DPD comparator. Before use they must be replaced
with the actual kit's printed scale, and validated against a lab colorimeter.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

CARD_W, CARD_H = 1000, 640          # canonical card size (px)
MARKER = 110
DICT = cv2.aruco.DICT_4X4_50
# approximate DPD free-chlorine comparator scale (mg/L -> sRGB), to be replaced per kit
DPD_SCALE = [(0.0, (250, 250, 250)), (0.1, (250, 229, 237)), (0.2, (247, 209, 225)),
             (0.3, (243, 191, 214)), (0.5, (236, 161, 195)), (1.0, (222, 112, 161))]
WHITE_BOX = (140, 40, 260, 140)                      # x0, y0, x1, y1
SAMPLE_BOX = (420, 230, 580, 410)
PATCH_Y = (480, 590)
PATCH_X0, PATCH_W, PATCH_GAP = 140, 110, 15


def _patch_boxes():
    return [(PATCH_X0 + i * (PATCH_W + PATCH_GAP), PATCH_Y[0],
             PATCH_X0 + i * (PATCH_W + PATCH_GAP) + PATCH_W, PATCH_Y[1]) for i in range(len(DPD_SCALE))]


def make_card(sample_rgb: tuple[int, int, int] | None = None) -> np.ndarray:
    """Render the reference card (BGR). With sample_rgb, also paint a sample in the window."""
    img = np.full((CARD_H, CARD_W, 3), 255, np.uint8)
    d = cv2.aruco.getPredefinedDictionary(DICT)
    for mid, (x, y) in enumerate([(10, 10), (CARD_W - MARKER - 10, 10),
                                  (CARD_W - MARKER - 10, CARD_H - MARKER - 10), (10, CARD_H - MARKER - 10)]):
        img[y:y + MARKER, x:x + MARKER] = cv2.cvtColor(cv2.aruco.generateImageMarker(d, mid, MARKER), cv2.COLOR_GRAY2BGR)
    x0, y0, x1, y1 = WHITE_BOX
    cv2.rectangle(img, (x0, y0), (x1, y1), (0, 0, 0), 2)
    cv2.putText(img, "WHITE", (x0 + 20, y1 + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1)
    for (mg, rgb), (a, b, c, e) in zip(DPD_SCALE, _patch_boxes()):
        img[b:e, a:c] = rgb[::-1]
        cv2.putText(img, f"{mg:g}", (a + 35, e + 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    x0, y0, x1, y1 = SAMPLE_BOX
    cv2.rectangle(img, (x0 - 4, y0 - 4), (x1 + 4, y1 + 4), (0, 0, 0), 2)
    cv2.putText(img, "PLACE SAMPLE", (x0 - 10, y0 - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1)
    cv2.putText(img, "JalKavach field card v0.1 - screening only - mg/L free chlorine",
                (140, 630), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (60, 60, 60), 1)
    if sample_rgb is not None:
        img[y0:y1, x0:x1] = sample_rgb[::-1]
    return img


def _rectify(bgr: np.ndarray) -> np.ndarray | None:
    det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(DICT), cv2.aruco.DetectorParameters())
    corners, ids, _ = det.detectMarkers(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
    if ids is None or len(set(ids.ravel()) & {0, 1, 2, 3}) < 4:
        return None
    outer = {0: 0, 1: 1, 2: 2, 3: 3}                 # use each marker's outer corner
    src, dst = [], []
    canon = {0: (10, 10), 1: (CARD_W - 10, 10), 2: (CARD_W - 10, CARD_H - 10), 3: (10, CARD_H - 10)}
    for c, i in zip(corners, ids.ravel()):
        if i in outer:
            src.append(c[0][outer[i]])
            dst.append(canon[i])
    H, _ = cv2.findHomography(np.float32(src), np.float32(dst))
    return cv2.warpPerspective(bgr, H, (CARD_W, CARD_H))


def _median(img, box, inset=0.2):
    x0, y0, x1, y1 = box
    dx, dy = int((x1 - x0) * inset), int((y1 - y0) * inset)
    return np.median(img[y0 + dy:y1 - dy, x0 + dx:x1 - dx].reshape(-1, 3), axis=0)


def _lab(rgb01: np.ndarray) -> np.ndarray:
    px = np.clip(rgb01, 0, 1).astype(np.float32).reshape(1, -1, 3)
    return cv2.cvtColor(px, cv2.COLOR_RGB2LAB).reshape(-1, 3)


@dataclass
class KitReading:
    ok: bool
    kind: str
    value_mg_l: float | None
    below_threshold: bool | None       # chlorine < 0.2 mg/L  (or H2S positive)
    margin: float                      # distance from the decision boundary, in scale units
    message: str


def read_photo(bgr: np.ndarray, kind: str = "chlorine", threshold: float = 0.2) -> KitReading:
    card = _rectify(bgr)
    if card is None:
        return KitReading(False, kind, None, None, 0.0, "Card not found: keep all 4 corner markers in frame.")
    white = _median(card, WHITE_BOX)[::-1] / 255.0            # RGB
    gain = 1.0 / np.maximum(white, 1e-3)
    sample = _median(card, SAMPLE_BOX)[::-1] / 255.0 * gain
    if kind == "h2s":
        lum = float(_lab(sample)[0, 0])
        pos = lum < 45
        return KitReading(True, kind, None, bool(pos), abs(lum - 45) / 45,
                          "H2S: black precipitate (positive)" if pos else "H2S: no blackening (negative)")
    refs = np.array([_median(card, b)[::-1] / 255.0 * gain for b in _patch_boxes()])
    L_ref, L_s = _lab(refs), _lab(sample)[0]
    d = np.linalg.norm(L_ref - L_s, axis=1)
    i = int(np.argmin(d))
    # interpolate between the two nearest neighbouring patches along the scale
    j = i + 1 if (i + 1 < len(d) and (i == 0 or d[i + 1] < d[i - 1])) else i - 1
    mg_i, mg_j = DPD_SCALE[i][0], DPD_SCALE[j][0]
    w = d[j] / (d[i] + d[j] + 1e-9)
    value = w * mg_i + (1 - w) * mg_j
    below = value < threshold
    margin = abs(value - threshold) / threshold
    msg = (f"≈{value:.2f} mg/L free chlorine. {'BELOW' if below else 'at/above'} 0.2 mg/L (IS 10500). "
           f"Screening only. Confirm with a lab test.")
    return KitReading(True, kind, float(value), bool(below), float(margin), msg)


def simulate_photo(sample_rgb: tuple[int, int, int], rng: np.random.Generator,
                   cast: tuple[float, float, float] | None = None, angle_deg: float | None = None) -> np.ndarray:
    """Synthetic phone photo of the card: perspective, colour cast, exposure, blur, noise."""
    card = make_card(sample_rgb).astype(np.float32)
    cast = cast or tuple(rng.uniform([0.8, 0.85, 0.65], [1.15, 1.05, 1.1]))
    card = card * np.array(cast[::-1]) * rng.uniform(0.7, 1.05)
    H, W = 900, 1300
    src = np.float32([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]])
    jit = rng.uniform(-60, 60, size=(4, 2)) if angle_deg is None else np.zeros((4, 2))
    dst = (np.float32([[150, 130], [1150, 110], [1180, 780], [120, 760]]) + jit).astype(np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    bg = np.full((H, W, 3), rng.uniform(60, 140), np.float32)
    warped = cv2.warpPerspective(card, M, (W, H), dst=bg, borderMode=cv2.BORDER_TRANSPARENT)
    warped = cv2.GaussianBlur(warped, (3, 3), rng.uniform(0.3, 1.2))
    warped += rng.normal(0, 4, warped.shape)
    return np.clip(warped, 0, 255).astype(np.uint8)
