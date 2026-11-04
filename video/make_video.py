#!/usr/bin/env python3
"""
Build the walkthrough video: narration (neural TTS) over smooth zooms of the
real app, with highlight boxes and burned-in captions.

Needs: the app served at BASE, Google Chrome, ffmpeg, Swift (Xcode CLT) and
the `edge-tts` package (pip install edge-tts). Output: video/walkthrough.mp4

    python3 -m http.server 8793 --bind 127.0.0.1   # from the repo root
    python3 video/make_video.py [--voice en-US-AvaNeural] [--silent]
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

BASE = "http://127.0.0.1:8793"
HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCALE = 2  # screenshots at 2x so zooms stay sharp

# ---------------------------------------------------------------- pages to capture
# key -> (route, {rect name: JS expression returning an element})
Q = "document.querySelector"
QA = "document.querySelectorAll"
PAGES = {
    "home": ("#/home", {
        "today": f"{Q}('.g-main-side .card')", "todo1": f"{QA}('.todo a')[0]", "todo2": f"{QA}('.todo a')[1]",
        "todo3": f"{QA}('.todo a')[2]", "tools": f"{Q}('.tools')"}),
    "cust": ("#/customer/1?tab=stopped", {
        "head": f"{Q}('main .card')", "tiles": f"{Q}('.tiles')", "rev": f"{QA}('.tile')[0]", "every": f"{QA}('.tile')[3]",
        "chart": f"{Q}('#ch')", "buy": f"{Q}('#tabs').closest('.card')", "tabs": f"{Q}('#tabs')", "rows": f"{Q}('#tb')"}),
    "stock": ("#/stock?c=1", {
        "panel": f"{Q}('#panel')", "head": f"{Q}('#panel .card-h')",
        "ok": f"[...{QA}('#panel tbody tr')].find(r => r.querySelector('.chip-good'))"}),
    "stockout": ("#/stock?c=1&only=out", {
        "panel": f"{Q}('#panel')", "out": f"[...{QA}('#panel tbody tr')].find(r => r.querySelector('.chip-bad') && r.children[4].textContent.includes('Nov'))",
        "arr": f"[...{QA}('#panel tbody tr')].find(r => r.querySelector('.chip-bad') && r.children[4].textContent.includes('Nov')).children[4]"}),
    "pick": ("#/catalog?c=12", {"selbar": f"{Q}('.selbar')", "grid": f"{Q}('.pgrid')", "from": f"{Q}('#from')"}),
    "build": ("#/catalog/build?c=12&prices=1", {
        "form": f"{Q}('#form')", "prices": f"{Q}('#prices').closest('label')", "cover": f"{QA}('.sheet')[0]",
        "p2": f"{QA}('.sheet')[1]", "p3": f"{QA}('.sheet')[2]", "price1": f"{Q}('.ccard .price')"}),
    "dash": ("#/dashboard", {
        "tiles": f"{Q}('.tiles')", "rev": f"{QA}('.tile')[0]", "margin": f"{QA}('.tile')[1]", "chart": f"{Q}('#ch-month').closest('.card')",
        "risk": f"{Q}('#risk').closest('.card')", "risk1": f"{Q}('#risk .todo a')", "stock": f"{Q}('#stock-health').closest('.card')"}),
    "about": ("#/about", {"flow": f"{Q}('.flow')", "further": f"{Q}('ol')", "rules": f"{QA}('.prose')[0]"}),
}
CARDS = {
    "title": dict(h="From Odoo to the people who sell",
                  p="A sales toolkit for a food distributor: live stock, customer profiles, catalogues and a dashboard.",
                  n="Demo with a fictional company and made-up data · narrated with an AI voice"),
    "outro": dict(h="People who sell should spend their time selling.",
                  p="Not looking for information.",
                  n="Odoo Sales Toolkit · built by Sofia · fictional company and data"),
}

# ---------------------------------------------------------------- the story
# Each scene: narration + shots. A shot: page, weight (share of scene time),
# camera from/to, highlights [(rect, start fraction, end fraction)].
FULL = ("full",)
SCENES = [
    dict(say="Hi, I'm Sofia. A quick note before we start: I built the full working version of this for the company I work at now. "
             "Their data is confidential, so everything you'll see runs on a made-up company, with made-up data.",
         shots=[dict(page="title", w=1, cam=(FULL, FULL))]),
    dict(say="Picture a food distributor with ninety customers and two hundred products. Everything about the business lives in their system, Odoo: "
             "the warehouse, the customers, what's on the way. But those screens are made for the office, not for the people selling. "
             "So salespeople phone the warehouse, and dig through spreadsheets.",
         shots=[dict(page="home", w=1, cam=(("fit", "tools", 1.6), FULL))]),
    dict(say="So this is the first thing a salesperson sees in the morning. Not a report: a to-do list. "
             "These products a customer was waiting for are back in stock. These customers usually order around now. "
             "And these shipments land in the next three weeks.",
         shots=[dict(page="home", w=1, mv=.3, cam=(FULL, ("fit", "today", 1.08)),
                     hl=[("todo1", .30, .55), ("todo2", .56, .76), ("todo3", .77, 1)])]),
    dict(say="Before a visit, one page tells me everything about a customer. This supermarket chain spent almost three hundred thousand euros with us "
             "in the last year, and orders about every nine days.",
         shots=[dict(page="cust", w=1, mv=.45, cam=(("fit", "head", 1.15), ("fit", "tiles", 1.1)), hl=[("rev", .45, .75), ("every", .76, 1)])]),
    dict(say="But the most useful part is this: what they've stopped buying. That's usually a lost sale that nobody noticed.",
         shots=[dict(page="cust", w=1, mv=.4, cam=(("fit", "tiles", 1.1), ("fit", "buy", 1.05, "top")), hl=[("tabs", .4, 1)])]),
    dict(say="Can I promise them their usual order? Green means yes: it's in the warehouse, and free to sell. "
             "Red means no, but here's the date the next shipment arrives, and the purchase order it's on.",
         shots=[dict(page="stock", w=.45, cam=(("fit", "panel", 1.0, "top"), ("fit", "panel", 1.0, "top")), hl=[("ok", .3, 1)]),
                dict(page="stockout", w=.55, mv=.45, cam=(("fit", "panel", 1.0, "top"), ("fit", "arr", 5.5)), hl=[("arr", .35, 1)])]),
    dict(say="Making a catalogue for one customer by hand can take three or four hours in PowerPoint. "
             "Here, I start from what that customer already buys, and get a branded, print-ready PDF in about two minutes. "
             "Prices only appear if I switch them on, so nothing out of date gets sent.",
         shots=[dict(page="pick", w=.5, mv=.5, cam=(FULL, ("fit", "selbar", 1.25)), hl=[("selbar", .55, 1)]),
                dict(page="build", w=.25, cam=(("fit", "form", 1.05), ("fit", "cover", 1.02))),
                dict(page="build", w=.25, mv=.5, cam=(("fit", "p2", 1.02, "top"), ("fit", "price1", 3.2)), hl=[("price1", .45, 1)])]),
    dict(say="For the owner, there's a dashboard. Sales are up about fifteen percent on last year, at a thirty-three percent margin. "
             "And the part I like most: this customer usually orders every twelve days, and hasn't ordered in seven weeks. "
             "That's fifty thousand euros a year, and a phone call worth making today.",
         shots=[dict(page="dash", w=.45, mv=.35, cam=(FULL, ("fit", "tiles", 1.05)), hl=[("rev", .35, .7), ("margin", .7, 1)]),
                dict(page="dash", w=.55, mv=.25, cam=(("fit", "chart", 1.05), ("fit", "risk", 1.25)), hl=[("risk1", .3, 1)])]),
    dict(say="If I did this for a client, I'd go in three steps. First, listen: a day with the sales team, writing down the questions they keep asking. "
             "Second, one quick win in two weeks, connected read-only so nothing can break, and measured: hours saved, and sales won back. "
             "Third, make the information come to them: a Monday email or WhatsApp, built with n8n, with who's due to reorder, "
             "what's back in stock, and what's about to expire.",
         shots=[dict(page="about", w=.35, cam=(FULL, ("fit", "flow", 1.05))),
                dict(page="about", w=.65, cam=(("fit", "further", 1.6), ("fit", "further", 1.15)), hl=[("further", .1, 1)])]),
    dict(say="That's the whole idea: people who sell should spend their time selling, not looking for information. Thanks for watching!",
         shots=[dict(page="outro", w=1, cam=(FULL, FULL))]),
]

XFADE = 0.5
LEAD, TAIL = 0.35, 0.55   # silence before / after each scene's narration


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def chrome(args, prof):
    return subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={prof}", "--hide-scrollbars",
                           "--virtual-time-budget=9000"] + args, capture_output=True, text=True, timeout=120)


def capture(tmp: Path):
    info = {}
    for key, (route, rects) in PAGES.items():
        q = urllib.parse.quote(json.dumps(list(rects.items())))
        url = f"{BASE}/video/measure.html?u={urllib.parse.quote(route)}&q={q}"
        dom = chrome(["--window-size=1920,1080", "--dump-dom", url], tmp / f"m-{key}").stdout
        m = re.search(r"@@(.*?)@@", html.unescape(dom), re.S)
        if not m:
            sys.exit(f"could not measure {key}")
        res = json.loads(m.group(1))
        bad = {k: v for k, v in res["rects"].items() if isinstance(v, str)}
        if bad:
            sys.exit(f"{key}: {bad}")
        h = max(1080, res["height"])
        img = BUILD / f"{key}.png"
        chrome([f"--window-size=1920,{h}", f"--force-device-scale-factor={SCALE}", f"--screenshot={img}", f"{BASE}/{route}"], tmp / f"s-{key}")
        info[key] = dict(img=str(img), height=h, rects=res["rects"])
        print(f"  {key}: {h}px tall, {len(res['rects'])} rects")
    for key, c in CARDS.items():
        img = BUILD / f"{key}.png"
        chrome(["--window-size=1920,1080", f"--force-device-scale-factor={SCALE}", f"--screenshot={img}",
                f"{BASE}/video/card.html?{urllib.parse.urlencode(c)}"], tmp / f"c-{key}")
        info[key] = dict(img=str(img), height=1080, rects={})
    return info


def camera(spec, page):
    """camera [x, y, w] in CSS px; height = w * 9/16"""
    if spec[0] == "full":
        return [0, 0, 1920]
    _, name, zoom, *anchor = spec
    x, y, w, h = page["rects"][name]
    cw = max(w * zoom, h * zoom * 16 / 9, 640)
    cw = min(cw, 1920)
    ch = cw * 9 / 16
    cx = x + w / 2 - cw / 2
    cy = y - 40 if anchor and anchor[0] == "top" else y + h / 2 - ch / 2
    cx = min(max(cx, 0), 1920 - cw)
    cy = min(max(cy, 0), page["height"] - ch)
    return [round(cx, 1), round(cy, 1), round(cw, 1)]


def tts(text, out: Path, voice, rate):
    venv_tts = shutil.which("edge-tts") or str(Path(sys.executable).parent / "edge-tts")
    run([venv_tts, "--voice", voice, f"--rate={rate}", "--text", text, "--write-media", str(out)])
    d = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)]).stdout)
    return d


def caption_chunks(text):
    parts = re.split(r"(?<=[.!?:])\s+", text)
    out = []
    for p in parts:
        while len(p) > 95:   # split long sentences at a comma near the middle
            cut = max((m.start() for m in re.finditer(r", ", p) if m.start() < 95), default=p.rfind(" ", 0, 95))
            out.append(p[:cut + 1].strip())
            p = p[cut + 1:].strip()
        if p:
            out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="en-US-AvaNeural")
    ap.add_argument("--rate", default="+3%")
    ap.add_argument("--skip-capture", action="store_true")
    a = ap.parse_args()
    BUILD.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp())

    print("capturing pages…")
    info_path = BUILD / "pages.json"
    if a.skip_capture and info_path.exists():
        info = json.loads(info_path.read_text())
    else:
        info = capture(tmp)
        info_path.write_text(json.dumps(info, indent=1))

    print("voice…")
    t = 0.0
    shots, captions, audio_parts = [], [], []
    for i, sc in enumerate(SCENES):
        mp3 = BUILD / f"vo-{i:02d}.mp3"
        d = tts(sc["say"], mp3, a.voice, a.rate)
        dur = LEAD + d + TAIL
        audio_parts.append((mp3, dur))
        # captions timed by characters spoken
        chunks = caption_chunks(sc["say"])
        total = sum(len(c) for c in chunks)
        ct = t + LEAD
        for c in chunks:
            cd = d * len(c) / total
            captions.append(dict(text=c, t0=round(ct, 3), t1=round(ct + cd - 0.05, 3)))
            ct += cd
        # shots share the scene by weight; each overlaps the next by XFADE
        st = t
        wsum = sum(s["w"] for s in sc["shots"])
        for s in sc["shots"]:
            sd = dur * s["w"] / wsum
            page = info[s["page"]]
            hls = [dict(r=page["rects"][n], t0=f0 * sd, t1=f1 * sd + XFADE) for n, f0, f1 in s.get("hl", [])]
            shots.append(dict(img=page["img"], scale=SCALE, start=round(st, 3), dur=round(sd + XFADE, 3),
                              **{"from": camera(s["cam"][0], page)}, to=camera(s["cam"][1], page), hls=hls, mv=s.get("mv", 1)))
            st += sd
        t += dur
        print(f"  scene {i}: {d:.1f}s narration")
    total = t
    print(f"total {total:.1f}s")
    (BUILD / "timeline.json").write_text(json.dumps(dict(fps=30, total=total, xfade=XFADE, shots=shots, captions=captions), indent=1))

    # audio: each scene padded to its slot, then joined
    wavs = []
    for i, (mp3, dur) in enumerate(audio_parts):
        w = BUILD / f"vo-{i:02d}.wav"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(mp3), "-af", f"adelay={int(LEAD * 1000)}:all=1,apad",
             "-t", f"{dur:.3f}", "-ar", "48000", "-ac", "2", str(w)])
        wavs.append(w)
    lst = BUILD / "audio.txt"
    lst.write_text("".join(f"file '{w}'\n" for w in wavs))
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-af", "loudnorm=I=-16:TP=-1.5", str(BUILD / "voice.wav")])

    print("rendering frames…")
    exe = BUILD / "render"
    if not exe.exists() or exe.stat().st_mtime < (HERE / "render.swift").stat().st_mtime:
        run(["swiftc", "-O", str(HERE / "render.swift"), "-o", str(exe)])
    out = HERE / "walkthrough.mp4"
    r = subprocess.Popen([str(exe), str(BUILD / "timeline.json")], stdout=subprocess.PIPE)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", "1920x1080", "-r", "30", "-i", "-",
                    "-i", str(BUILD / "voice.wav"), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out)], stdin=r.stdout, check=True)
    r.wait()
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
