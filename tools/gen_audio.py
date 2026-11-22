#!/usr/bin/env python3
"""预生成拼音音频（构建期脚本，不在运行时调用 TTS）。

用法：
    python tools/gen_audio.py --requests ../src/content/audio-requests.json --out ../public/audio/v1

三条合成路径，按 requests 里的 kind 分派：
    1. 同音汉字  edge-tts 朗读「波」得到 bō           —— initial / final / whole / syllable / word / sentence / song
    2. 声调改写  pyworld 改 f0 轮廓（单韵母四声专用）  —— vowel-tone
    3. 腾讯云    <phoneme alphabet="py" ph="bo1">      —— --engine tencent（需密钥，缺密钥静默跳过）

设计约束见 ../拼音学习网站规划方案.md 第 8.1/8.2 节与附录 A。
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
import threading
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import numpy as np
except ImportError:  # vowel-tone 路径才需要 numpy
    np = None  # type: ignore[assignment]

# ---------------------------------------------------------------- 配置

VOICE = "zh-CN-XiaoyiNeural"
FALLBACK_VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-20%"
OUT_SAMPLE_RATE = 22050
OUT_BITRATE = "48k"
PAD_HEAD_MS = 80  # 首部缓冲，别再多，否则吃掉「点击到出声」的 150ms 预算
PAD_TAIL_MS = 110  # 尾部略多，mp3 编码器会吃掉 20ms 左右
SILENCE_DB = -55  # 裁静音门限（放宽，避免削掉 b/p/d 的爆破起始）
TARGET_LUFS = -16  # 全站统一的积分响度目标（儿童内容不做太响，避免听觉疲劳）
TARGET_WRMS_DBFS = -16.5  # K 加权 RMS 目标；实测与 -16 LUFS 相差不到 0.5dB
K_WEIGHT = "highpass=f=80,highshelf=f=1500:g=4"

# 单韵母基准音：用一个零声母汉字让 TTS 发出接近纯元音的声音
VOWEL_BASE_TEXT = {"a": "啊", "o": "哦", "e": "鹅", "i": "衣", "u": "乌", "ü": "迂"}
# 清单里 ü 常写成 v（key 里也写成 v），统一到 VOWEL_BASE_TEXT 的写法
VOWEL_ALIAS = {"v": "ü", "u:": "ü", "ü": "ü", "Ü": "ü", "V": "ü"}

# 五度标记：阴平 55 / 阳平 35 / 上声 214 / 去声 51
TONE_CONTOUR = {
    1: ((0.0, 5.0), (1.0, 5.0)),
    2: ((0.0, 3.0), (0.15, 3.0), (1.0, 5.0)),
    3: ((0.0, 2.4), (0.3, 0.8), (0.7, 3.0), (1.0, 4.0)),
    4: ((0.0, 5.0), (0.2, 4.4), (1.0, 1.0)),
}
TONE_DURATION = {1: 0.55, 2: 0.55, 3: 0.70, 4: 0.50}
SEMITONE_PER_LEVEL = 2.2  # 五度区间约 8.8 个半音，接近正常朗读的声调跨度
FRAME_PERIOD_MS = 5.0

KIND_DIRS = {
    "initial": "initial",
    "final": "final",
    "vowel-tone": "final",
    "whole": "whole",
    "syllable": "syllable",
    "word": "word",
    "sentence": "sentence",
    "song": "song",
}
EDGE_KINDS = {"initial", "final", "whole", "syllable", "word", "sentence", "song"}

LIMIT_DEFAULT = 0.891  # 限幅到 -1dBFS；mp3 编码还会再冲 0.5~0.6dB
# 个别条目在响度校正之后再整体降一点：播放器可能叠淡入或音量提升，
# 孩子把平板音量拉满时不能让峰值贴着 0dB。降的是整体电平，不是限幅——
# 只压低限幅门限是没用的，校正循环会把增益补回来。
KEY_GAIN_DB = {"init_h": -1.2, "d02_ba_3": -1.2}

# 多音字：汉字本身有多个读音，TTS 选哪个由上下文决定，脚本看不出来，只能标待人耳
PENDING_REVIEW = {
    "init_d": "呼读音「得」可能读成 dé/děi（教材标准用字，读音有争议）",
    "d02_fa_1": "「发」可能读成 fà（fā 无可替换的同音字）",
}
TZ = timezone(timedelta(hours=8))


# ---------------------------------------------------------------- 小工具


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def have(binary: str) -> bool:
    return shutil.which(binary) is not None


def probe_duration_ms(path: Path) -> int | None:
    if not have("ffprobe"):
        return None
    proc = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ])
    if proc.returncode != 0:
        return None
    try:
        return int(round(float(proc.stdout.strip()) * 1000))
    except ValueError:
        return None


def decode_to_float(path: Path, sample_rate: int) -> "np.ndarray":
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1",
         "-ar", str(sample_rate), "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 解码失败: {path}\n{proc.stderr.decode('utf-8', 'replace')}")
    return np.frombuffer(proc.stdout, dtype=np.float32).astype(np.float64)


def write_wav(path: Path, samples: "np.ndarray", sample_rate: int) -> None:
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(sample_rate)
        fh.writeframes(pcm.tobytes())


def measure_loudnorm(src: Path) -> dict | None:
    """跑一次 loudnorm 的测量模式，拿回 input_i / input_tp / input_lra / input_thresh。"""
    proc = run([
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(src),
        "-af", f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json",
        "-f", "null", "-",
    ])
    text = proc.stderr or ""
    start, end = text.rfind("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    try:
        return {
            "input_i": float(data["input_i"]),
            "input_tp": float(data["input_tp"]),
            "input_lra": float(data["input_lra"]),
            "input_thresh": float(data["input_thresh"]),
            "target_offset": float(data.get("target_offset", 0.0)),
        }
    except (KeyError, TypeError, ValueError):
        return None


def postprocess(src: Path, dst: Path, accurate_lufs: bool = False, workdir: Path | None = None,
                limiter: float = LIMIT_DEFAULT, gain_db: float = 0.0) -> bool:
    """裁首尾静音 → 响度归一 → 首尾补静音 → 22.05kHz/48kbps mp3。

    `accurate_lufs=True` 走「测量 → 增益 → 限幅」的迭代校正，而不是单遍 loudnorm：
    单遍的动态模式在 0.4–0.9s 的短音频上落点极不稳（实测 129 条的积分响度散到 10 LU）。

    两个坑：
    1. 别用峰值对齐。元音波峰因数不同，把 24 条峰值拉到同一 dBFS，ü 会比 a 响 9dB。
    2. 光靠 loudnorm 的线性模式也到不了目标：波峰因数 18dB 的条目（带爆破的）想升 6dB
       就必然削顶，loudnorm 会安静地不给你升，最后停在 -22 LUFS。所以必须让 `alimiter`
       兜住波峰，再用测量值校正一次。

    ffmpeg 不存在时直接复制（不做后处理），返回 False。
    """
    if not have("ffmpeg"):
        shutil.copyfile(src, dst)
        return False
    trim = (
        f"silenceremove=start_periods=1:start_duration=0.01:start_threshold={SILENCE_DB}dB:detection=peak,"
        "areverse,"
        f"silenceremove=start_periods=1:start_duration=0.01:start_threshold={SILENCE_DB}dB:detection=peak,"
        "areverse"
    )
    source = src
    tail = (
        f"apad=pad_dur={PAD_TAIL_MS / 1000},"
        f"adelay=delays={PAD_HEAD_MS}:all=1"
    )

    if accurate_lufs:
        if workdir is None or np is None:
            raise RuntimeError("响度校正需要 workdir 与 numpy")
        # 先裁静音并补齐首尾，再在这个「最终形状」上做响度校正——
        # 补进去的 190ms 静音会稀释 RMS，在校正之后再加就会差 2dB
        current = workdir / f"{dst.stem}_trim.wav"
        proc = run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
            "-af", f"{trim},{tail}", "-ac", "1", "-ar", str(OUT_SAMPLE_RATE), str(current),
        ])
        if proc.returncode != 0 or not current.exists():
            raise RuntimeError(f"ffmpeg 裁静音失败: {dst}\n{proc.stderr}")

        level = weighted_rms_dbfs(current)
        if level is None:
            raise RuntimeError(f"无法测量响度: {dst}")
        # 至少过一遍 limiter：即使电平刚好达标，也要把 -0.4dBFS 这种过热的峰值压到 -1dBFS，
        # 否则 mp3 解码后可能削顶
        for index in range(3):
            delta = TARGET_WRMS_DBFS - level
            nxt = workdir / f"{dst.stem}_norm{index}.wav"
            proc = run([
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(current),
                "-af", f"volume={delta:.2f}dB,alimiter=limit={limiter:.3f}",
                "-ac", "1", "-ar", str(OUT_SAMPLE_RATE), str(nxt),
            ])
            if proc.returncode != 0 or not nxt.exists():
                raise RuntimeError(f"ffmpeg 响度校正失败: {dst}\n{proc.stderr}")
            current = nxt
            if abs(delta) >= 0.3:
                level = weighted_rms_dbfs(current)
                if level is None:
                    break
                continue
            break
        # 长度变了，补一次边界淡入淡出防止 limiter 带来咔哒声
        presets = f"volume={gain_db:.2f}dB," if gain_db else ""
        source = current
        chain = f"{presets}afade=t=in:d=0.008,areverse,afade=t=in:d=0.008,areverse"
    else:
        chain = f"{trim},loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11,{tail}"

    proc = run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
        "-af", chain, "-ac", "1", "-ar", str(OUT_SAMPLE_RATE),
        "-c:a", "libmp3lame", "-b:a", OUT_BITRATE, str(dst),
    ])
    if proc.returncode != 0 or not dst.exists():
        raise RuntimeError(f"ffmpeg 后处理失败: {dst}\n{proc.stderr}")
    return True


def weighted_rms_dbfs(path: Path) -> float | None:
    """K 加权 RMS（80Hz 高通 + 1.5kHz 高架 +4dB），不依赖最短时长，比 LUFS 更耐用。

    实测与 loudnorm 的 input_i 只差 0.0~1.2dB（同一批素材），但 0.2s 的短条目
    也能测——这正是 LUFS 搞不定的地方（量出来是 -inf），也是各条响度散掉的根因。
    """
    if np is None:
        return None
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-af", K_WEIGHT,
         "-f", "f32le", "-ac", "1", "-ar", str(OUT_SAMPLE_RATE), "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        return None
    samples = np.frombuffer(proc.stdout, dtype=np.float32).astype(np.float64)
    if not len(samples):
        return None
    rms = float(np.sqrt(np.mean(samples ** 2)))
    if rms <= 1e-6:
        return None
    return 20.0 * math.log10(rms)


# ---------------------------------------------------------------- 引擎


class EdgeEngine:
    """借用 Edge 朗读接口。不支持自定义 SSML，只能靠「同音汉字」控制读音。"""

    name = "edge-tts"

    def __init__(self, voice: str = VOICE):
        self.voice = voice

    async def _save(self, text: str, voice: str, rate: str, dst: Path) -> None:
        import edge_tts

        communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
        await communicate.save(str(dst))

    def synthesize(self, text: str, dst: Path, rate: str = RATE) -> str:
        """返回实际使用的音色。主音色失败时退回备用音色。"""
        for voice in (self.voice, FALLBACK_VOICE):
            tmp = dst.with_suffix(".part.mp3")
            try:
                asyncio.run(self._save(text, voice, rate, tmp))
            except Exception as exc:  # noqa: BLE001 - 网络/令牌问题都走同一退路
                tmp.unlink(missing_ok=True)
                if voice == FALLBACK_VOICE:
                    raise RuntimeError(f"edge-tts 合成失败（主/备音色均失败）: {text!r} — {exc}") from exc
                print(f"    主音色 {voice} 失败，回退 {FALLBACK_VOICE}：{exc}")
                continue
            if tmp.stat().st_size < 1000:
                tmp.unlink(missing_ok=True)
                raise RuntimeError(f"edge-tts 返回文件过小: {text!r}")
            tmp.replace(dst)
            return voice
        raise RuntimeError("edge-tts 不可用")


class TencentEngine:
    """腾讯云 TTS adapter 骨架。

    `--engine tencent` 时启用。缺 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 时
    依然可构造，只是 `available` 为 False，由调用方跳过而不是报错。
    """

    name = "tencent-tts"
    VOICE_TYPE = 101001  # 智瑜（儿童向女声），需按控制台账单核对
    SSML_TEMPLATE = (
        '<speak><phoneme alphabet="py" ph="{ph}">{text}</phoneme></speak>'
    )

    def __init__(self) -> None:
        import os

        self.secret_id = os.environ.get("TENCENT_SECRET_ID", "").strip()
        self.secret_key = os.environ.get("TENCENT_SECRET_KEY", "").strip()

    @property
    def available(self) -> bool:
        return bool(self.secret_id and self.secret_key)

    def build_ssml(self, text: str, ph: str) -> str:
        return self.SSML_TEMPLATE.format(ph=ph.replace(" ", ""), text=text)

    def synthesize(self, text: str, ph: str, dst: Path) -> None:
        """未用真实密钥验证过，接入前必须先跑通单条再批量。

        SDK 装法：.venv/Scripts/pip install tencentcloud-sdk-python-tts
        """
        if not self.available:
            raise RuntimeError("缺少 TENCENT_SECRET_ID / TENCENT_SECRET_KEY")
        try:
            import base64
            import uuid

            from tencentcloud.common import credential
            from tencentcloud.tts.v20190823 import models, tts_client
        except ImportError as exc:
            raise RuntimeError(
                "缺少腾讯云 SDK：.venv/Scripts/pip install tencentcloud-sdk-python-tts"
            ) from exc

        ssml = self.build_ssml(text, ph)
        client = tts_client.TtsClient(
            credential.Credential(self.secret_id, self.secret_key), "ap-guangzhou"
        )
        request = models.TextToVoiceRequest()
        request.Text = base64.b64encode(ssml.encode("utf-8")).decode("ascii")
        request.SessionId = uuid.uuid4().hex
        request.VoiceType = self.VOICE_TYPE
        request.Speed = -0.2  # 与 edge 的 -20% 对齐（腾讯云为倍率，非百分比）
        request.Volume = 0
        request.EnableSubtitle = False
        response = client.TextToVoice(request)
        dst.write_bytes(base64.b64decode(response.Audio))
        if dst.stat().st_size < 1000:
            raise RuntimeError("腾讯云返回音频过小")


# ---------------------------------------------------------------- vowel-tone


class VowelToneSynthesizer:
    """用 pyworld 把「啊」这类持续元音的 f0 换成目标声调轮廓。

    孤立元音是持续音，formant 不变、只改音高，听感比硬找同音汉字自然得多。
    任何一步不成立（缺 pyworld / 浊音段太短 / 合成异常）都返回 False，
    由调用方退回同音汉字并标记 verified=false。
    """

    def __init__(self, engine: EdgeEngine):
        self.engine = engine
        try:
            import pyworld

            self.pyworld = pyworld
        except ImportError:
            self.pyworld = None

    def synthesize(self, vowel: str, tone: int, dst: Path, workdir: Path,
                   limiter: float = LIMIT_DEFAULT) -> bool:
        vowel = VOWEL_ALIAS.get(vowel, vowel)
        if self.pyworld is None or np is None or not have("ffmpeg") or tone not in TONE_CONTOUR:
            return False
        base_text = VOWEL_BASE_TEXT.get(vowel)
        if not base_text:
            return False

        raw_mp3 = workdir / f"{vowel}{tone}_base.mp3"
        raw_wav = workdir / f"{vowel}{tone}_base.wav"
        shaped_wav = workdir / f"{vowel}{tone}_shaped.wav"
        try:
            self.engine.synthesize(base_text, raw_mp3)
            run(["ffmpeg", "-y", "-v", "error", "-i", str(raw_mp3), "-ac", "1",
                 "-ar", "24000", str(raw_wav)])
            if not raw_wav.exists():
                return False
            if not self._reshape(raw_wav, shaped_wav, tone):
                return False
            postprocess(shaped_wav, dst, accurate_lufs=True, workdir=workdir, limiter=limiter,
                                 gain_db=extra_gain)
            return True
        except Exception as exc:  # noqa: BLE001 - 失败即退回，不中断整批
            print(f"    pyworld 路径失败（{vowel} 声{tone}）：{exc}")
            return False

    def _reshape(self, src: Path, dst: Path, tone: int) -> bool:
        pw = self.pyworld
        sr = 24000
        hop = 120  # 5ms
        x = decode_to_float(src, sr)
        f0, t = pw.harvest(x, sr, f0_floor=70, f0_ceil=500)

        # 只看「有能量」的浊音帧：起音的气声和收尾的弱化会把声调轮廓吃掉一半
        energy = np.array([
            float(np.sqrt(np.mean(x[i * hop : (i + 1) * hop] ** 2))) if i * hop < len(x) else 0.0
            for i in range(len(f0))
        ])
        cap = energy.max() or 1.0
        keep = np.where((f0 > 0) & (energy > 0.12 * cap))[0]
        if len(keep) < 25:
            return False
        v0, v1 = int(keep[0]) + 3, int(keep[-1])  # 再让开 15ms，去掉起音的跳变

        sp = pw.cheaptrick(x, f0, t, sr)
        ap = pw.d4c(x, f0, t, sr)

        duration = TONE_DURATION[tone]
        frames = int(duration * 1000 / FRAME_PERIOD_MS)
        idx = np.linspace(v0, v1, frames).round().astype(int)
        sp2, ap2 = sp[idx].copy(), ap[idx]

        # 压平幅度包络：元音是持续音，不该保留「啊」自身的强弱起伏
        src_energy = np.maximum(energy[idx], 1e-4)
        gain = np.clip((0.5 * cap) / src_energy, 0.25, 4.0)
        kernel = np.ones(5) / 5.0
        gain = np.convolve(gain, kernel, mode="same")
        sp2 *= gain[:, None]

        ref = float(np.median(f0[v0 : v1 + 1]))
        points = TONE_CONTOUR[tone]
        levels = np.interp(
            np.linspace(0.0, 1.0, frames),
            [p[0] for p in points],
            [p[1] for p in points],
        )
        semitones = (levels - 3.0) * SEMITONE_PER_LEVEL
        f0_new = (ref * 2.0 ** (semitones / 12.0)).astype(np.float64)

        y = pw.synthesize(f0_new, sp2, ap2, sr)
        peak = float(np.max(np.abs(y))) or 1.0
        y = y * (0.7 / peak)
        fade = int(0.015 * sr)
        if len(y) > 2 * fade:
            y[:fade] *= np.linspace(0.0, 1.0, fade)
            y[-fade:] *= np.linspace(1.0, 0.0, fade)
        write_wav(dst, y, sr)
        return True


# ---------------------------------------------------------------- 主流程


def spec_hash(item: dict, engine_label: str, voice: str) -> str:
    payload = "|".join([
        str(item.get("text", "")),
        str(item.get("ph", "")),
        str(item.get("kind", "")),
        str(item.get("tone", "")),
        engine_label,
        voice,
        RATE,
        str(PAD_HEAD_MS),
        str(PAD_TAIL_MS),
        "lufs2pass",
        "pending" if item.get("key") in PENDING_REVIEW else "",
    ])
    if item.get("key") in KEY_GAIN_DB:
        payload += f"|gain={KEY_GAIN_DB[item['key']]}"
    return sha256_text(payload)[:16]


def load_manifest(path: Path) -> dict:
    if not path.exists():
        return {"files": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"! manifest 损坏，按全新处理: {path}")
        return {"files": []}


def matches_only(key: str, patterns: list[str]) -> bool:
    if not patterns:
        return True
    for pattern in patterns:
        if pattern.endswith("*") and key.startswith(pattern[:-1]):
            return True
        if key == pattern:
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="预生成拼音音频")
    parser.add_argument("--requests", required=True, help="audio-requests.json 路径")
    parser.add_argument("--out", required=True, help="输出目录，例如 ../public/audio/v1")
    parser.add_argument("--engine", choices=["edge", "tencent", "auto"], default="auto",
                        help="auto=能连腾讯云就用腾讯云，否则 edge")
    parser.add_argument("--only", action="append", default=[],
                        help="只生成指定 key，可重复；支持前缀通配 d05_*")
    parser.add_argument("--force", action="store_true", help="忽略 manifest，全部重生成")
    parser.add_argument("--jobs", type=int, default=3, help="edge-tts 并发数，默认 3")
    args = parser.parse_args()

    req_path = Path(args.requests).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    items = json.loads(req_path.read_text(encoding="utf-8"))
    if not isinstance(items, list):
        print("requests 文件应为数组", file=sys.stderr)
        return 2
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = out_dir / "manifest.json"
    manifest = load_manifest(manifest_path)
    old_entries = {entry["key"]: entry for entry in manifest.get("files", [])}

    edge = EdgeEngine()
    tencent = TencentEngine()
    use_tencent = args.engine == "tencent" or (args.engine == "auto" and tencent.available)
    if args.engine == "tencent" and not tencent.available:
        print("腾讯云密钥未配置（TENCENT_SECRET_ID / TENCENT_SECRET_KEY），本条引擎跳过。")
        print("其余条目请改用 --engine edge 生成。")
        return 0
    if use_tencent:
        print("合成引擎：腾讯云 TTS（phoneme 标注）")
    else:
        print(f"合成引擎：edge-tts（{VOICE}，rate={RATE}）")

    if not have("ffmpeg"):
        print("! 未找到 ffmpeg：跳过响度归一与首尾补静音，音频按 TTS 原样输出")

    selected = [item for item in items if matches_only(item["key"], args.only)]
    if not selected:
        print(f"没有匹配的条目（--only {args.only}）")
        return 1

    scratch = Path(tempfile.mkdtemp(prefix="gen_audio_"))
    stats = {"generated": 0, "skipped": 0, "fallback": 0, "failed": 0}
    lock_guard = threading.Lock()

    def handle(item: dict) -> dict | None:
        key = item["key"]
        kind = item["kind"]
        subdir = KIND_DIRS.get(kind)
        if subdir is None:
            print(f"FAIL {key}: 未知 kind={kind}")
            with lock_guard:
                stats["failed"] += 1
            return None

        rel_path = f"{subdir}/{key}.mp3"
        target = out_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        entry_engine = tencent.name if use_tencent else edge.name
        voice_for_hash = tencent.name if use_tencent else VOICE
        limiter = LIMIT_DEFAULT
        extra_gain = KEY_GAIN_DB.get(key, 0.0)
        current_hash = spec_hash(item, entry_engine, voice_for_hash)
        prev = old_entries.get(key)

        # 人工录音优先：manifest 里标了 sourceFile / human-recording 的条目一律不覆盖
        if prev and not args.force and (prev.get("sourceFile") or prev.get("kind") == "human-recording"):
            with lock_guard:
                stats["skipped"] += 1
            print(f"SKIP {key}（已有录音源 {prev.get('sourceFile')}，不覆盖）")
            return prev

        if (
            not args.force
            and target.exists()
            and prev
            and prev.get("specHash") == current_hash
            and prev.get("sha256") == sha256_file(target)
        ):
            with lock_guard:
                stats["skipped"] += 1
            print(f"SKIP {key}（sha256 一致）")
            return prev

        try:
            verified = True
            note = ""
            used_voice = voice_for_hash
            if use_tencent:
                tencent.synthesize(item["text"], item["ph"], target)
            elif kind == "vowel-tone":
                shaper = VowelToneSynthesizer(edge)
                tmp_mp3 = scratch / f"{key}_homophone.mp3"
                if shaper.synthesize(item.get("vowel") or item["ph"].split()[0], int(item["tone"]),
                                     target, scratch, limiter=limiter):
                    note = "pyworld 声调轮廓"
                else:
                    used_voice = edge.synthesize(item["text"], tmp_mp3)
                    postprocess(tmp_mp3, target, accurate_lufs=True, workdir=scratch,
                                limiter=limiter, gain_db=extra_gain)
                    verified = False
                    note = "pyworld 不可用，退回同音汉字"
                    with lock_guard:
                        stats["fallback"] += 1
                    print(f"WARN {key}: {note}")
            elif kind in EDGE_KINDS:
                tmp_mp3 = scratch / f"{key}.mp3"
                used_voice = edge.synthesize(item["text"], tmp_mp3)
                postprocess(tmp_mp3, target, accurate_lufs=True, workdir=scratch,
                                limiter=limiter, gain_db=extra_gain)
            else:
                raise ValueError(f"未知 kind={kind}")

            if not target.exists() or target.stat().st_size == 0:
                raise RuntimeError("输出文件为空")

            duration = probe_duration_ms(target)
            if duration is not None and not _duration_ok(duration, kind):
                verified = False
                note = (note + "；" if note else "") + f"时长异常 {duration}ms"

            entry = {
                "key": key,
                "path": rel_path,
                "text": item["text"],
                "ph": item["ph"],
                "kind": kind,
                "tone": item.get("tone"),
                "durationMs": duration,
                "bytes": target.stat().st_size,
                "sha256": sha256_file(target),
                "verified": verified,
                "note": note,
                "engine": entry_engine,
                "voice": used_voice,
                "rate": RATE,
                "specHash": current_hash,
                "generatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
            }
            if key in PENDING_REVIEW:
                # 多音字靠上下文定音，TTS 读对读错看不出来，只能人耳判
                entry["verified"] = False
                entry["reviewStatus"] = "pending-human"
                entry["note"] = (note + "；" if note else "") + PENDING_REVIEW[key]
            with lock_guard:
                stats["generated"] += 1
            print(f"OK   {key}  {duration or '?'}ms  {entry['bytes']} B  {entry['note']}".rstrip())
            return entry
        except Exception as exc:  # noqa: BLE001 - 单条失败不拖垮整批
            print(f"FAIL {key}: {exc}")
            with lock_guard:
                stats["failed"] += 1
            return None

    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        results = list(pool.map(handle, selected))

    fresh = {entry["key"]: entry for entry in results if entry}
    for key, entry in old_entries.items():
        if key in fresh:
            continue
        if (out_dir / entry.get("path", "")).exists():
            fresh[key] = entry

    order = [item["key"] for item in items]
    files = [fresh[key] for key in order if key in fresh]
    files += [entry for key, entry in fresh.items() if key not in order]

    # 保留 manifest 里已有的顶层字段（license / project / notes 等，人工录音的署名不能丢）
    merged = dict(manifest)
    merged["version"] = manifest.get("version") or out_dir.name
    if stats["generated"]:  # 这一轮没合成任何东西时，别篡改 voice / generatedAt
        merged.update({
            "voice": tencent.name if use_tencent else VOICE,
            "rate": RATE,
            "engine": tencent.name if use_tencent else edge.name,
            "generatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
        })
    merged["files"] = files
    manifest_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.rmtree(scratch, ignore_errors=True)

    print(
        f"\n生成 {stats['generated']} / 跳过 {stats['skipped']} / "
        f"回退 {stats['fallback']} / 失败 {stats['failed']}；manifest 共 {len(files)} 条"
    )
    return 1 if stats["failed"] else 0


def _duration_ok(duration_ms: int, kind: str) -> bool:
    if kind in {"word", "sentence"}:
        return 250 <= duration_ms <= 6000
    if kind == "song":
        return 250 <= duration_ms <= 12000
    return 250 <= duration_ms <= 1500


if __name__ == "__main__":
    sys.exit(main())
