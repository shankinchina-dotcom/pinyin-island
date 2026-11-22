#!/usr/bin/env python3
"""校验预生成音频的技术指标，输出 CSV 报告。

    python tools/verify_audio.py --manifest ../public/audio/v1/manifest.json

检查项：空文件、时长区间、首尾静音、峰值电平、削波。
vowel-tone 额外做一次 f0 轮廓比对，确认四声确实被区分开（不做 ASR，离线中文识别不可靠）。

退出码：全部通过 0，有不过条目 1（--lenient 时始终 0）。
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

SILENCE_DBFS = -50.0
SILENCE_AMP = 10 ** (SILENCE_DBFS / 20)
MIN_HEAD_SILENCE_MS = 60
MIN_TAIL_SILENCE_MS = 60

TONE_CONTOUR = {
    1: ((0.0, 5.0), (1.0, 5.0)),
    2: ((0.0, 3.0), (0.15, 3.0), (1.0, 5.0)),
    3: ((0.0, 2.4), (0.3, 0.8), (0.7, 3.0), (1.0, 4.0)),
    4: ((0.0, 5.0), (0.2, 4.4), (1.0, 1.0)),
}

DURATION_RANGE = {
    "default": (250, 1500),
    "word": (250, 6000),
    "sentence": (250, 6000),
    "song": (250, 12000),
}


def decode(path: Path, sample_rate: int) -> np.ndarray:
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1",
         "-ar", str(sample_rate), "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace").strip())
    return np.frombuffer(proc.stdout, dtype=np.float32).astype(np.float64)


def silence_ms(samples: np.ndarray, sample_rate: int, head: bool) -> float:
    loud = np.abs(samples) > SILENCE_AMP
    if not loud.any():
        return round(len(samples) / sample_rate * 1000, 1)
    idx = np.argmax(loud) if head else len(loud) - np.argmax(loud[::-1])
    count = idx if head else len(loud) - idx
    return round(count / sample_rate * 1000, 1)


def dbfs(value: float) -> float | None:
    if value <= 0:
        return None
    return round(20 * np.log10(value), 1)


def contour_st(samples: np.ndarray, sample_rate: int) -> tuple[list[float], float] | None:
    """取浊音段内 6 个采样点的半音轮廓（相对该条自身中位 f0）。"""
    try:
        import pyworld as pw
    except ImportError:
        return None

    f0, _t = pw.harvest(samples, sample_rate, f0_floor=70, f0_ceil=500)
    voiced = np.where(f0 > 0)[0]
    if len(voiced) < 20:
        return None
    seg = f0[voiced[0] : voiced[-1] + 1]
    mask = seg > 0
    filled = np.interp(np.arange(len(seg)), np.arange(len(seg))[mask], seg[mask])
    # 去掉首尾 10%（起音和收尾最不稳）
    lo, hi = int(len(filled) * 0.1), int(len(filled) * 0.9)
    core = filled[lo:hi] if hi - lo >= 6 else filled
    points = np.interp(
        np.linspace(0.0, 1.0, 6), np.linspace(0.0, 1.0, len(core)), core
    )
    ref = float(np.median(filled))
    return [round(float(12 * np.log2(value / ref)), 1) for value in points], ref


def tone_match(semis: list[float] | None, tone: int | None) -> str:
    """按四声的区分性特征判定轮廓是否成立（比相关系数更好解释）。"""
    if tone not in TONE_CONTOUR or not semis:
        return ""
    start, end = semis[0], semis[-1]
    lowest = min(semis)
    lowest_at = semis.index(lowest) / max(len(semis) - 1, 1)
    span = max(semis) - min(semis)

    if tone == 1:  # 55 平
        return "yes" if span <= 2.5 else ("weak" if span <= 4.0 else "no")
    if tone == 2:  # 35 升
        rise = end - start
        return "yes" if rise >= 2.5 else ("weak" if rise >= 1.2 else "no")
    if tone == 3:  # 214 降升
        dip = start - lowest
        rise = end - lowest
        if lowest_at <= 0.65 and dip >= 1.5 and rise >= 3.0:
            return "yes"
        return "weak" if dip >= 1.0 and rise >= 2.0 else "no"
    if tone == 4:  # 51 降
        drop = start - end
        return "yes" if drop >= 3.0 else ("weak" if drop >= 1.5 else "no")
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="校验预生成音频")
    parser.add_argument("--manifest", default="../public/audio/v1/manifest.json")
    parser.add_argument("--csv", default="audio-report.csv", help="报告输出路径")
    parser.add_argument("--lenient", action="store_true", help="有失败也返回 0")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        print("需要 ffmpeg/ffprobe 才能校验", file=sys.stderr)
        return 2

    manifest_path = Path(args.manifest).expanduser().resolve()
    base_dir = manifest_path.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest.get("files", [])
    if not entries:
        print(f"manifest 里没有条目: {manifest_path}")
        return 2

    sample_rate = 22050
    rows: list[dict] = []
    for entry in entries:
        key = entry.get("key", "?")
        kind = entry.get("kind", "")
        path = base_dir / entry.get("path", "")
        row = {
            "key": key, "kind": kind, "path": entry.get("path", ""),
            "durationMs": "", "headSilenceMs": "", "tailSilenceMs": "",
            "peakDbfs": "", "rmsDbfs": "", "contourSt": "", "toneMatch": "",
            "verified": entry.get("verified", ""), "reviewStatus": entry.get("reviewStatus", ""),
            "pass": "no", "reasons": "", "note": entry.get("note", ""),
        }

        if not path.exists():
            row["reasons"] = "文件不存在"
            rows.append(row)
            continue
        if path.stat().st_size < 1000:
            row["reasons"] = f"文件过小 {path.stat().st_size}B"
            rows.append(row)
            continue

        try:
            samples = decode(path, sample_rate)
        except Exception as exc:  # noqa: BLE001
            row["reasons"] = f"解码失败: {exc}"
            rows.append(row)
            continue

        reasons: list[str] = []
        duration_ms = round(len(samples) / sample_rate * 1000, 1)
        low, high = DURATION_RANGE.get(kind, DURATION_RANGE["default"])
        head = silence_ms(samples, sample_rate, head=True)
        tail = silence_ms(samples, sample_rate, head=False)
        peak = float(np.max(np.abs(samples)))
        rms = float(np.sqrt(np.mean(samples ** 2)))

        row.update({
            "durationMs": duration_ms,
            "headSilenceMs": head,
            "tailSilenceMs": tail,
            "peakDbfs": dbfs(peak),
            "rmsDbfs": dbfs(rms),
        })

        if not (low <= duration_ms <= high):
            reasons.append(f"时长 {duration_ms}ms 超出 {low}-{high}ms")
        if head < MIN_HEAD_SILENCE_MS:
            reasons.append(f"首静音 {head}ms < {MIN_HEAD_SILENCE_MS}ms")
        if tail < MIN_TAIL_SILENCE_MS:
            reasons.append(f"尾静音 {tail}ms < {MIN_TAIL_SILENCE_MS}ms")
        if peak >= 0.999:
            reasons.append("削波")
        elif dbfs(peak) is not None and dbfs(peak) < -15:
            # -15dBFS 以上都算正常：鼻韵母/单韵母频谱密集，-16 LUFS 下峰值本来就只有 -6~-12
            reasons.append(f"峰值偏低 {dbfs(peak)}dBFS，疑似没读出来")

        if kind == "vowel-tone":
            result = contour_st(samples, sample_rate)
            if result:
                semis, _ref = result
                row["contourSt"] = ",".join(f"{value:+.1f}" for value in semis)
                row["toneMatch"] = tone_match(semis, entry.get("tone"))
                if row["toneMatch"] == "no":
                    reasons.append("声调轮廓与目标不符")
                elif row["toneMatch"] == "weak":
                    row["note"] = "；".join(filter(None, [row["note"], "声调轮廓不明确，建议人工试听"]))

        row["pass"] = "no" if reasons else "yes"
        row["reasons"] = "；".join(reasons)
        rows.append(row)

    csv_path = Path(args.csv).expanduser().resolve()
    fieldnames = [
        "key", "kind", "path", "durationMs", "headSilenceMs", "tailSilenceMs",
        "peakDbfs", "rmsDbfs", "contourSt", "toneMatch", "verified", "reviewStatus",
        "pass", "reasons", "note",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    failed = [row for row in rows if row["pass"] == "no"]
    print(f"共 {len(rows)} 条，通过 {len(rows) - len(failed)} 条，未通过 {len(failed)} 条")
    for row in failed[:20]:
        print(f"  ✗ {row['key']}: {row['reasons']}")
    print(f"报告：{csv_path}")
    if failed and not args.lenient:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
