#!/usr/bin/env python3
"""修「爸爸」，并按实际文件刷新 manifest。"""
import json, os, subprocess, hashlib, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "public/audio/v1")
RAW = os.path.join(ROOT, "tools/_human_raw2")
BAK = os.path.join(ROOT, "tools/_backup_tts")
AF = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,"
      "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,"
      "loudnorm=I=-16:TP=-1.5:LRA=11,adelay=80|80,apad=pad_dur=0.11")

# --- 爸爸：ba4 + ba5 限长 0.75s ---
ba4 = os.path.join(RAW, "cdn_ba4.mp3")
ba5src = os.path.abspath(os.path.join(ROOT, "..", "app/public/audio/v1/phonetics/ba5.mp3"))
ba5 = os.path.join(RAW, "ba5_short.mp3")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", ba5src, "-t", "0.75", "-c", "copy", ba5],
               capture_output=True)
lst = os.path.join(RAW, "baba.txt")
open(lst, "w", encoding="utf-8").write("file '%s'\nfile '%s'\n" %
                                       (ba4.replace("\\", "/"), ba5.replace("\\", "/")))
joined = os.path.join(RAW, "baba_join.mp3")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst,
                "-c", "copy", joined], capture_output=True)
target = None
for dirpath, _, files in os.walk(AUD):
    if "d02_w_baba.mp3" in files:
        target = os.path.join(dirpath, "d02_w_baba.mp3")
        break
assert target, "找不到 d02_w_baba.mp3"
tmp = os.path.join(AUD, "tmp_baba.mp3")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", joined, "-af", AF, "-ar", "22050",
                "-ac", "1", "-b:a", "48k", tmp], capture_output=True)
d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", tmp], capture_output=True, text=True).stdout.strip() or 0)
if os.path.exists(target) and 0.4 <= d <= 1.9:
    bak = os.path.join(BAK, "d02_w_baba.mp3")
    if not os.path.exists(bak):
        shutil.copy2(target, bak)
    os.replace(tmp, target)
    print(f"爸爸 修复成功 {d:.2f}s")
else:
    if os.path.exists(tmp):
        os.remove(tmp)
    print(f"爸爸 仍未通过 {d:.2f}s")

# --- 刷新 manifest ---
res = json.load(open(os.path.join(RAW, "result.json"), encoding="utf-8"))
done = {r["key"]: r for r in res if r["status"] in ("ok", "ok-concat")}
done["d02_w_baba"] = {"key": "d02_w_baba", "status": "ok-concat", "durationMs": round(d * 1000)}

mp = os.path.join(AUD, "manifest.json")
m = json.load(open(mp, encoding="utf-8"))
n = 0
for f in m["files"]:
    k = f["key"]
    if k in done:
        p = os.path.join(AUD, f["path"])
        if not os.path.exists(p):
            continue
        b = open(p, "rb").read()
        dd = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                   "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip() or 0)
        f.update({
            "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest(), "durationMs": round(dd * 1000),
            "source": "human-recording" if done[k]["status"] == "ok" else "human-recording-concat",
            "sourceFile": done[k].get("src", "syllable-concat"),
            "license": "CC BY-SA",
            "verified": False,
            "reviewStatus": "pending-teacher-review",
            "note": "真人录音，audio-cmn / Chen Wang，CC BY-SA；已裁静音、响度归一、22.05kHz 单声道",
        })
        n += 1
m["humanRecordings"] = sum(1 for f in m["files"] if str(f.get("source", "")).startswith("human-recording"))
json.dump(m, open(mp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"manifest 更新 {n} 条，人声合计 {m['humanRecordings']} / {len(m['files'])}")

from collections import Counter
print("当前来源分布:", dict(Counter(f.get("source", "tts") for f in m["files"])))
for f in m["files"]:
    if not str(f.get("source", "")).startswith("human"):
        print("  仍为 TTS:", f["key"])
