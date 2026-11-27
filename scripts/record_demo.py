"""Record the hands-free story mode to an MP4 fallback (for when a live demo can't run).

Drives a local Chrome over the DevTools protocol: resets the session, starts story mode (P),
records screencast frames with their timestamps, notes each caption as it appears, then
narrates the captions with Sarvam Bulbul (en-IN narration voice; macOS `say` as an offline fallback) and muxes everything with ffmpeg.

    make app            # server on :8036 in another terminal
    make video          # -> media/jalkavach_story.mp4
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT = Path(__file__).resolve().parents[1]
SARVAM_URL = "https://api.sarvam.ai/text-to-speech"
# romanised Hindi in captions is spoken from Devanagari by a Hindi voice (Sarvam: romanised Indic lowers quality)
HINDI_LINES = {"Swachhta mein number one. Ab suraksha mein bhi.": "स्वच्छता में नंबर वन। अब सुरक्षा में भी।"}
# What the narrator SAYS: written for the ear, short enough to breathe inside each story step
# (the on-screen captions stay as they are). Keyed by the start of each caption; {..} are filled
# from the live caption so numbers always match the screen.
SPOKEN = [
    ("Ward 00", "This is a ward in Indore. The streets are real; the pipes are simulated. It's seven in the morning, and the water is flowing."),
    ("Noon", "By noon, the supply stops. The pipes lose pressure... and that's exactly when sewage can seep in."),
    ("Day by day", "Complaints trickle in, one at a time. A smell here. Yellow water there."),
    ("The engine weighs", "JalKavach weighs every pipe against the chance that nothing is wrong. And then... an alert."),
    ("The alert opens", "It can't name the spot yet. But it says where to test first: {search} kilometres, not {total}."),
    ("7 pm", "That evening, a resident sends a voice note: near the park. But several parks match, so the officer simply calls back."),
    ("The city's clock", "Now the city's own clock is running. The ward engineer acknowledges, well within the deadline."),
    ("Next morning", "Next morning, two routine water tests fail, close to the complaints."),
    ("Day ", "By evening, the search is down to {km} kilometres of pipe, and about {people} residents."),
    ("The Executive Engineer", "The engineer confirms. Then the health officer signs off on the Hindi advisory."),
    ("A tamper-evident", "And every step lands on a record that no one can quietly rewrite."),
    ("Tested on", "We tested all of it on simulations held back in advance, and we show what didn't work, too."),
    ("One ward", "One ward today. Every city, by 2036. Swachhta mein number one. Ab suraksha mein bhi."),
]


def spoken(caption: str) -> str:
    """The narration line for a caption, with its numbers taken from the caption itself."""
    nums = re.findall(r"\d[\d,]*(?:\.\d+)?", caption)
    for key, line in SPOKEN:
        if caption.startswith(key):
            try:
                if "{search}" in line:
                    return line.format(total=nums[0], search=nums[1])
                if "{km}" in line:
                    return line.format(km=nums[2], people=nums[4])
            except IndexError:
                return caption
            return line
    return caption


CAPTION_JS = ("(() => { const e = document.querySelector('[role=status][aria-live=polite] span.flex-1');"
              " return e ? e.textContent : ''; })()")


def _json(url: str, data: bytes | None = None):
    req = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"null")


async def record(base: str, w: int, h: int, seconds: float, frames_dir: Path, gpu: bool) -> tuple[list, list]:
    port = 9333
    flags = ["--use-angle=metal"] if gpu else ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", "--hide-scrollbars",
                               f"--window-size={w},{h}", "--autoplay-policy=no-user-gesture-required",
                               f"--user-data-dir={tempfile.mkdtemp()}", *flags, "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tabs = _json(f"http://127.0.0.1:{port}/json")
                break
            except OSError:
                time.sleep(0.2)
        ws_url = next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page")
        async with websockets.connect(ws_url, max_size=64 * 2**20) as ws:
            n = 0
            pending: dict[int, asyncio.Future] = {}
            frames: list[tuple[float, str]] = []
            captions: list[tuple[float, str]] = []

            async def send(method: str, params: dict | None = None):
                nonlocal n
                n += 1
                fut = asyncio.get_event_loop().create_future()
                pending[n] = fut
                await ws.send(json.dumps({"id": n, "method": method, "params": params or {}}))
                return await fut

            async def pump():
                async for raw in ws:
                    m = json.loads(raw)
                    if "id" in m and m["id"] in pending:
                        pending.pop(m["id"]).set_result(m.get("result"))
                    elif m.get("method") == "Page.screencastFrame":
                        p = m["params"]
                        f = frames_dir / f"f{len(frames):05d}.jpg"
                        f.write_bytes(base64.b64decode(p["data"]))
                        frames.append((p["metadata"]["timestamp"], f.name))
                        asyncio.ensure_future(send("Page.screencastFrameAck", {"sessionId": p["sessionId"]}))

            pumper = asyncio.ensure_future(pump())
            await send("Page.enable")
            await send("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})
            await send("Page.navigate", {"url": f"{base}/?view=command&day=4&hour=7&reset"})
            await asyncio.sleep(9)                                   # app + map warm-up
            await send("Page.startScreencast", {"format": "jpeg", "quality": 88, "maxWidth": w, "maxHeight": h, "everyNthFrame": 1})
            await asyncio.sleep(1.0)
            for typ in ("keyDown", "keyUp"):
                await send("Input.dispatchKeyEvent", {"type": typ, "key": "p", "code": "KeyP", "text": "p" if typ == "keyDown" else "", "windowsVirtualKeyCode": 80})
            t0 = time.time()
            last = ""
            while time.time() - t0 < seconds:
                r = await send("Runtime.evaluate", {"expression": CAPTION_JS, "returnByValue": True})
                txt = (r or {}).get("result", {}).get("value") or ""
                if txt and txt != last:
                    captions.append((time.time(), txt))
                    last = txt
                await asyncio.sleep(0.2)
            await send("Page.stopScreencast")
            await asyncio.sleep(0.5)
            pumper.cancel()
            return frames, captions
    finally:
        chrome.terminate()


def build(frames, captions, frames_dir: Path, out: Path, voice: str, fps: int) -> None:
    t_start = frames[0][0]
    lines = []
    for i, (ts, name) in enumerate(frames):
        dur = (frames[i + 1][0] - ts) if i + 1 < len(frames) else 1.0
        lines += [f"file '{name}'", f"duration {max(dur, 0.001):.4f}"]   # real time: never pad short frames
    lines.append(f"file '{frames[-1][1]}'")
    (frames_dir / "list.txt").write_text("\n".join(lines))
    silent = frames_dir / "video.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "list.txt",
                    "-vf", f"fps={fps},format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
                    silent.name], cwd=frames_dir, check=True)
    if not captions:
        shutil.copy(silent, out)
        return
    t0 = frames[0][0]
    clips = []                                   # (start_s, wav, duration_s)
    for k, (ts, text) in enumerate(captions):
        wav = frames_dir / f"c{k}.wav"
        tts(spoken(text), wav, voice)
        clips.append([max(0.0, ts - t0), wav, _dur(wav)])
        print(f"  tts {k:2d}: {clips[-1][2]:4.1f}s  {spoken(text)[:60]}")
    # fit: a line may be sped up a little to end before the next caption; never overlap the next line
    end_prev = 0.0
    for k, c in enumerate(clips):
        slot = (clips[k + 1][0] - c[0] - 0.25) if k + 1 < len(clips) else 1e9
        if c[2] > slot > 0:
            f = min(c[2] / slot, 1.06)              # beyond ~6% faster, speech stops sounding natural
            fast = c[1].with_name(c[1].stem + "_fit.wav")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(c[1]), "-filter:a", f"atempo={f:.3f}", str(fast)], check=True)
            c[1], c[2] = fast, _dur(fast)
        late = max(0.0, end_prev + 0.2 - c[0])
        c[0] += late
        end_prev = c[0] + c[2]
        print(f"  line {k:2d}: at {c[0]:5.1f}s  {c[2]:4.1f}s long  slot {min(slot, 99):4.1f}s" + (f"  LATE {late:.1f}s" if late else ""))
    inputs, filters = [], []
    for k, (start, wav, _) in enumerate(clips):
        inputs += ["-i", str(wav)]
        ms = int(start * 1000)
        filters.append(f"[{k + 1}:a]aresample=48000,adelay={ms}|{ms}[a{k}]")
    mix = "".join(f"[a{k}]" for k in range(len(clips)))
    filters.append(f"{mix}amix=inputs={len(clips)}:normalize=0,highpass=f=70,acompressor=threshold=-20dB:ratio=2.2:attack=20:release=250,loudnorm=I=-16:TP=-1.5[aud]")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent), *inputs,
                    "-filter_complex", ";".join(filters), "-map", "0:v", "-map", "[aud]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", str(out)], check=True)


def _dur(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def _sarvam_key() -> str | None:
    if os.environ.get("SARVAM_API_KEY"):
        return os.environ["SARVAM_API_KEY"]
    env = ROOT / ".env"                                       # gitignored
    if env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith("SARVAM_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def _sarvam(text: str, lang: str, speaker: str, out: Path) -> None:
    body = json.dumps({"text": text, "language_code": lang, "speaker": speaker, "model": "bulbul:v4-flash",
                       "speech_sample_rate": 48000, "enable_preprocessing": True,
                       "pace": float(os.environ.get("NARRATION_PACE", "0.95"))}).encode()
    req = urllib.request.Request(SARVAM_URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "api-subscription-key": _sarvam_key() or ""})
    with urllib.request.urlopen(req, timeout=60) as r:
        audios = json.loads(r.read())["audios"]
    parts = []
    for i, a in enumerate(audios):
        p = out.with_name(f"{out.stem}_{i}.wav")
        p.write_bytes(base64.b64decode(a))
        parts.append(p)
    _concat(parts, out)


def _concat(parts: list[Path], out: Path) -> None:
    if len(parts) == 1:
        shutil.copy(parts[0], out)
        return
    lst = out.with_suffix(".txt")
    lst.write_text("\n".join(f"file '{p.name}'" for p in parts))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst.name,
                    "-ar", "48000", "-ac", "1", out.name], cwd=out.parent, check=True)


def tts(text: str, out: Path, voice: str) -> None:
    """voice: 'sarvam:<english persona>' (Hindi lines use the same narrator's Hindi persona) or a macOS `say` voice."""
    text = text.replace("“", '"').replace("”", '"')
    if voice.startswith("sarvam:"):
        en = voice.split(":", 1)[1]
        hi = en.split("_")[0] + "_hi_narration"
        segs: list[tuple[str, str, str]] = []
        rest = text
        for roman, deva in HINDI_LINES.items():
            if roman in rest:
                before, after = rest.split(roman, 1)
                if before.strip():
                    segs.append((before.strip(), "en-IN", en))
                segs.append((deva, "hi-IN", hi))
                rest = after
        if rest.strip():
            segs.append((rest.strip(), "en-IN", en))
        parts = []
        for i, (t, lang, spk) in enumerate(segs):
            p = out.with_name(f"{out.stem}_s{i}.wav")
            _sarvam(t, lang, spk, p)
            parts.append(p)
        _concat(parts, out)
        return
    aiff = out.with_suffix(".aiff")
    subprocess.run(["say", "-v", voice, "-r", "178", "-o", str(aiff), text], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-ar", "48000", str(out)], check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8036")
    ap.add_argument("--size", default="1600x900")
    ap.add_argument("--seconds", type=float, default=92)
    ap.add_argument("--narrate-only", action="store_true",
                    help="reuse the last screen recording (media/.take) and only redo the voice")
    ap.add_argument("--voice", default="sarvam:simran_en_narration",
                    help="sarvam:<persona> (needs SARVAM_API_KEY in the environment or .env) or a macOS `say` voice")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--swiftshader", action="store_true", help="software WebGL (slower, for machines without a GPU)")
    ap.add_argument("--out", default=str(ROOT / "media" / "jalkavach_story.mp4"))
    a = ap.parse_args()
    if a.voice.startswith("sarvam:") and not _sarvam_key():
        raise SystemExit("Set SARVAM_API_KEY (environment or .env), or pass --voice Rishi for the offline Mac voice")
    w, h = map(int, a.size.split("x"))
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    _json(f"{a.base}/api/reset", b"{}")
    take = ROOT / "media" / ".take"                 # last screen recording, kept so the voice can be redone alone
    if a.narrate_only:
        meta = json.loads((take / "take.json").read_text())
        frames, caps = [tuple(f) for f in meta["frames"]], [tuple(c) for c in meta["captions"]]
    else:
        shutil.rmtree(take, ignore_errors=True)
        take.mkdir(parents=True)
        frames, caps = asyncio.run(record(a.base, w, h, a.seconds, take, gpu=not a.swiftshader))
        (take / "take.json").write_text(json.dumps({"frames": frames, "captions": caps}))
    with tempfile.TemporaryDirectory() as d:
        for f in take.glob("f*.jpg"):
            os.symlink(f, Path(d) / f.name)
        span = frames[-1][0] - frames[0][0] if frames else 0
        print(f"{len(frames)} frames over {span:.1f} s ({len(frames) / max(span, 1e-9):.1f} fps captured), {len(caps)} captions")
        build(frames, caps, Path(d), out, a.voice, a.fps)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
