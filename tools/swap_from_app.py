#!/usr/bin/env python3
"""用 app/ 里已下载好的 phonetics 人声覆盖剩余 TTS 音频。"""
import json, os, shutil, subprocess, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "public/audio/v1")
SRC = os.path.abspath(os.path.join(ROOT, "..", "app/public/audio/v1/phonetics"))
RAW = os.path.join(ROOT, "tools/_human_raw2")
BAK = os.path.join(ROOT, "tools/_backup_tts")
for d in (RAW, BAK):
    os.makedirs(d, exist_ok=True)

AF = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,"
      "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,"
      "loudnorm=I=-16:TP=-1.5:LRA=11,adelay=80|80,apad=pad_dur=0.11")

INIT = {"b":"bo1","p":"po1","m":"mo1","f":"fo1","d":"de1","t":"te1","n":"ne1","l":"le1",
        "g":"ge1","k":"ke1","h":"he1","j":"ji1","q":"qi1","x":"xi1","zh":"zhi1","ch":"chi1",
        "sh":"shi1","r":"ri1","z":"zi1","c":"ci1","s":"si1","y":"yi1","w":"wu1"}
FIN = {"a":"a1","o":"o1","e":"e1","i":"yi1","u":"wu1","v":"yu1","ai":"ai1","ei":"ei1",
       "ui":"wei1","ao":"ao1","ou":"ou1","iu":"you1","ie":"ye1","ve":"yue1","er":"er2",
       "an":"an1","en":"en1","in":"yin1","un":"wen1","vn":"yun1","ang":"ang1",
       "eng":"eng1","ing":"ying1"}
WHOLE = {"zhi":"zhi1","chi":"chi1","shi":"shi1","ri":"ri4","zi":"zi1","ci":"ci1","si":"si1",
         "yi":"yi1","wu":"wu1","yu":"yu1","ye":"ye1","yue":"yue4","yuan":"yuan2",
         "yin":"yin1","yun":"yun2","ying":"ying1"}
WORDS = {"d02_w_baba":["ba4","ba5"],"d02_w_mama":["ma1","ma5"],"d02_w_muma":["mu4","ma3"],
         "d02_w_pashan":["pa2","shan1"],"d02_w_bi":["bi3"],"d03_w_dami":["da4","mi3"],
         "d03_w_tuzi":["tu4","zi5"],"d03_w_nainai":["nai3","nai3"],"d03_w_laoshi":["lao3","shi1"],
         "d03_w_lizi":["li2","zi5"]}

req = json.load(open(os.path.join(ROOT, "src/content/audio-requests.json"), encoding="utf-8"))


def target_of(key):
    for dirpath, _, files in os.walk(AUD):
        if f"{key}.mp3" in files:
            return os.path.join(dirpath, f"{key}.mp3")
    return None


CDN = "https://cdn.jsdelivr.net/gh/hugolpz/audio-cmn@master/64k/syllabs/cmn-%s.mp3"

def src_file(name):
    p = os.path.join(SRC, f"{name}.mp3")
    if os.path.exists(p) and os.path.getsize(p) > 1000:
        return p
    # 本地缺失时回源下载（同一个数据源）
    out = os.path.join(RAW, f"cdn_{name}.mp3")
    if os.path.exists(out) and os.path.getsize(out) > 3000:
        return out
    r = subprocess.run(["curl", "-sL", "-m", "20", "-o", out, "-w", "%{http_code}", CDN % name],
                       capture_output=True, text=True)
    if r.stdout.strip() == "200" and os.path.exists(out) and os.path.getsize(out) > 3000:
        return out
    if os.path.exists(out):
        os.remove(out)
    return None


def dur(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", p], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def encode(srcs, out):
    if len(srcs) == 1:
        inp = ["-i", srcs[0]]
    else:
        lst = out + ".txt"
        with open(lst, "w", encoding="utf-8") as f:
            for s in srcs:
                f.write("file '%s'\n" % s.replace("\\", "/"))
        joined = out + ".join.mp3"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                        "-i", lst, "-c", "copy", joined], capture_output=True)
        if not os.path.exists(joined):
            return False
        inp = ["-i", joined]
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", *inp, "-af", AF,
                        "-ar", "22050", "-ac", "1", "-b:a", "48k", out],
                       capture_output=True, text=True)
    return r.returncode == 0


results = []
for x in req:
    key = x["key"]
    if key.startswith("d01_"):
        continue
    tgt = target_of(key)
    if not tgt:
        results.append({"key": key, "status": "missing-target"})
        continue
    kind, tone = x["kind"], x.get("tone") or 0

    if key in WORDS:
        srcs = [src_file(n) for n in WORDS[key]]
        if not all(srcs):
            results.append({"key": key, "status": "tts-fallback", "reason": "缺音节: " +
                            ",".join(n for n, s in zip(WORDS[key], srcs) if not s)})
            continue
        out = os.path.join(AUD, "tmp_%s.mp3" % key)
        if not encode(srcs, out):
            results.append({"key": key, "status": "reverted", "reason": "编码失败"})
            continue
        d = dur(out)
        if not (0.40 <= d <= 2.60):
            os.remove(out)
            results.append({"key": key, "status": "reverted", "reason": f"时长 {d:.2f}s"})
            continue
        bak = os.path.join(BAK, f"{key}.mp3")
        if not os.path.exists(bak):
            shutil.copy2(tgt, bak)
        os.replace(out, tgt)
        results.append({"key": key, "status": "ok-concat", "durationMs": round(d * 1000),
                        "path": os.path.relpath(tgt, AUD).replace("\\", "/")})
        continue

    name = None
    if kind == "initial":
        name = INIT.get(key[5:])
    elif kind == "final":
        name = FIN.get(key[4:])
    elif kind == "whole":
        name = WHOLE.get(key[6:])
    elif kind == "syllable":
        parts = key.split("_")
        name = f"{parts[1]}{x.get('tone') or 1}"
    src = src_file(name) if name else None
    if not src:
        results.append({"key": key, "status": "tts-fallback", "reason": f"无 {name}"})
        continue
    out = os.path.join(AUD, "tmp_%s.mp3" % key)
    if not encode([src], out):
        results.append({"key": key, "status": "reverted", "reason": "编码失败"})
        continue
    d = dur(out)
    if not (0.30 <= d <= 1.50):
        os.remove(out)
        results.append({"key": key, "status": "reverted", "reason": f"时长 {d:.2f}s", "src": name})
        continue
    bak = os.path.join(BAK, f"{key}.mp3")
    if not os.path.exists(bak):
        shutil.copy2(tgt, bak)
    os.replace(out, tgt)
    results.append({"key": key, "status": "ok", "src": name, "durationMs": round(d * 1000),
                    "path": os.path.relpath(tgt, AUD).replace("\\", "/")})

json.dump(results, open(os.path.join(RAW, "result.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
from collections import Counter
print(dict(Counter(r["status"] for r in results)))
for r in results:
    if r["status"] != "ok":
        print(" ", r["status"], r["key"], r.get("reason", ""))
