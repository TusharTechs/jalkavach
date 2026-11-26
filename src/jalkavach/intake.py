"""Citizen complaint intake: voice or text in Hindi, Hinglish or English, turned into a
structured, geocoded complaint.

  audio --(faster-whisper, local, optional)--> text
  text  --(offline rule extractor, Hindi + Hinglish lexicon)--> {colour, odour, symptoms, place}
  place --(rapidfuzz on transliterated text vs OSM street/POI gazetteer)--> node + radius

Everything runs offline. Transcripts of the demo clips are cached, so the demo works
without downloading a speech model.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate
from rapidfuzz import fuzz

from .config import CACHE

TRANSCRIPTS = CACHE / "transcripts.json"

LEXICON = {
    "colour": {
        "yellow": ["पीला", "पीली", "peela", "pila", "yellow"],
        "muddy": ["मटमैला", "मैला", "गंदा", "गंदी", "gandा", "ganda", "gandi", "muddy", "dirty", "matmaila"],
        "black": ["काला पानी", "काले रंग", "black"],
        "white/foamy": ["झाग", "jhaag", "foam"],
    },
    "odour": {
        "sewage": ["बदबू", "badbu", "badboo", "बू", "smell", "stink", "गटर", "gutter", "नाली", "nali"],
        "chlorine": ["क्लोरीन", "chlorine", "दवाई की गंध"],
    },
    "symptoms": {
        "diarrhoea": ["दस्त", "dast", "loose motion", "diarrhoea", "diarrhea", "पेट खराब"],
        "vomiting": ["उल्टी", "ulti", "vomit"],
        "fever": ["बुखार", "bukhar", "fever"],
        "stomach pain": ["पेट दर्द", "pet dard", "stomach"],
    },
}


@dataclass
class Complaint:
    text: str
    colour: list[str] = field(default_factory=list)
    odour: list[str] = field(default_factory=list)
    symptoms: list[str] = field(default_factory=list)
    place_text: str | None = None
    place_match: str | None = None
    match_score: float = 0.0
    node: int | None = None
    radius_m: float | None = None
    candidates: int = 0
    water_quality: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------- speech

def _load_wav(path: str) -> np.ndarray:
    """16 kHz mono float32 samples from a WAV file (stdlib only, no PyAV/ffmpeg needed)."""
    import wave

    with wave.open(path, "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError("expected 16 kHz mono 16-bit WAV (convert with ffmpeg -ar 16000 -ac 1)")
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return x.astype(np.float32) / 32768.0


def transcribe(audio_path: str, model_size: str = "medium") -> str:
    """Transcribe Hindi audio locally with faster-whisper; cache by file hash."""
    digest = hashlib.sha1(Path(audio_path).read_bytes()).hexdigest()[:16]
    cache = json.loads(TRANSCRIPTS.read_text()) if TRANSCRIPTS.exists() else {}
    if digest in cache:
        return cache[digest]["text"]
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Install the voice extra: uv sync --extra voice") from exc
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segs, _ = model.transcribe(_load_wav(audio_path), language="hi", beam_size=5)
    text = " ".join(s.text.strip() for s in segs).strip()
    cache[digest] = {"text": text, "model": f"faster-whisper-{model_size}", "file": Path(audio_path).name}
    TRANSCRIPTS.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    return text


# ------------------------------------------------------------- extraction

SYNONYMS = {"सरकारी": "government", "स्कूल": "school", "विद्यालय": "school", "मंदिर": "mandir temple",
            "अस्पताल": "hospital", "क्लिनिक": "clinic", "दवाखाना": "clinic", "मेडिकल": "medical",
            "शौचालय": "sulabh complex", "सुलभ": "sulabh", "मस्जिद": "masjid mosque", "पार्क": "park"}


def _latin(text: str) -> str:
    if re.search(r"[ऀ-ॿ]", text):
        text = transliterate(text, sanscript.DEVANAGARI, sanscript.ITRANS)
    return re.sub(r"[^a-z0-9 ]", " ", text.lower())


def _has(word: str, text_l: str) -> bool:
    w = _latin(word)
    if not w:
        return False
    if f" {w} " in f" {text_l} ":
        return True
    return len(w) >= 4 and any(len(tok) >= 4 and fuzz.ratio(w, tok) >= 80 for tok in text_l.split())


def extract(text: str) -> Complaint:
    """Rule extractor on phonetically normalised text, tolerant of ASR spelling variants
    (e.g. गंडा/गंदा, दस्थ/दस्त, उल्ती/उल्टी)."""
    c = Complaint(text=text)
    tl = _latin(text)
    for slot, groups in LEXICON.items():
        hits = [k for k, words in groups.items() if any(_has(w, tl) for w in words)]
        setattr(c, slot, hits)
    c.water_quality = bool(c.colour or c.odour or c.symptoms)
    m = re.search(r"(.{2,40}?)\s*(के पास|के सामने|के पीछे|वाली गली|ke paas|ke pass|near|ke saamne)", text)
    c.place_text = m.group(1).strip() if m else None
    return c


# -------------------------------------------------------------- geocoding

class Gazetteer:
    """Street names (from OSM street segments) and named POIs, each mapped to a network node."""

    def __init__(self, ward, pois: list[dict] | None = None):
        self.entries: list[dict] = []
        nodes = ward.nodes
        lat, lon = nodes["lat"].to_numpy(), nodes["lon"].to_numpy()
        for name, grp in ward.pipes[ward.pipes["street"] != ""].groupby("street"):
            ends = list(grp["start"]) + list(grp["end"])
            idx = [nodes.index.get_loc(n) for n in ends]
            mid = idx[len(idx) // 2]
            self.entries.append({"name": name, "key": _latin(name), "node": int(mid), "radius_m": 150.0,
                                 "kind": "street"})
        inv = {}
        for hi, en in SYNONYMS.items():
            for w in en.split():
                inv.setdefault(w, hi)
        for p in pois or []:
            node = int(np.argmin((lat - p["lat"]) ** 2 + (lon - p["lon"]) ** 2))
            alias_hi = " ".join(inv.get(w.lower(), "") for w in p["name"].split()).split()
            alias_hi = " ".join(alias_hi) if len(alias_hi) >= 2 else ""   # drop lone generic words
            head_hi = (p.get("name_hi") or "").split()[-1] if p.get("name_hi") else ""
            for nm in {p["name"], p.get("name_hi") or "", alias_hi, head_hi} - {""}:
                self.entries.append({"name": p["name"], "key": _latin(nm), "node": node, "radius_m": 60.0,
                                     "kind": p.get("kind", "poi")})

    @classmethod
    def load(cls, ward) -> "Gazetteer":
        path = CACHE / f"pois_{ward.cfg['name']}.json"
        pois = json.loads(path.read_text()) if path.exists() else []
        return cls(ward, pois)

    @staticmethod
    def _score(key: str, query_tokens: list[str]) -> float:
        """Length-weighted token alignment: every word of the landmark must be heard."""
        toks = [t for t in key.split() if len(t) >= 2]
        if not toks or not query_tokens:
            return 0.0
        best = [max(fuzz.ratio(t, q) for q in query_tokens) for t in toks]
        w = np.array([len(t) for t in toks], float)
        return float((np.array(best) * w).sum() / w.sum())

    def geocode(self, c: Complaint, min_score: float = 75.0) -> Complaint:
        qt = _latin(c.place_text or c.text).split()
        best, score = None, 0.0
        scored = []
        for e in self.entries:
            s = self._score(e["key"], qt)
            scored.append((s, e))
            if s > score:
                best, score = e, s
        # several different places match equally well (e.g. "school" when there are 7)
        ties = {e["node"] for s, e in scored if s >= score - 1.0 and s >= min_score}
        c.candidates = len(ties)
        if best and score >= min_score:
            c.place_match, c.match_score, c.node, c.radius_m = best["name"], float(score), best["node"], best["radius_m"]
            if c.candidates > 1:
                c.radius_m = 250.0          # ambiguous landmark: widen the geocoding uncertainty
        return c


def process_text(text: str, gaz: Gazetteer) -> Complaint:
    return gaz.geocode(extract(text))
