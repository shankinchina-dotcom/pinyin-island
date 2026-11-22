# tools/ — 预生成拼音音频

构建期脚本，不在运行时调用 TTS。产出的 mp3 落进 `public/audio/v1/`，由前端用 Web Audio 播放。

| 脚本 | 作用 |
|---|---|
| `gen_audio.py` | 读 `src/content/audio-requests.json`，逐条合成 mp3 + 写 `manifest.json` |
| `verify_audio.py` | 校验时长 / 首尾静音 / 电平 / 声调轮廓，输出 CSV 报告 |
| `emit-audio-requests.mjs` | 从 `src/content/` 生成请求清单（内容侧维护） |
| `fetch_audio.py` | 下载人工录音（CC BY-SA），与 TTS 产物共存 |

需求依据：`../../拼音学习网站规划方案.md` 第 8.1、8.2 节 + 附录 A。

## 1. 装依赖

```bash
cd pinyin-island
python -m venv .venv
.venv/Scripts/pip install edge-tts pyworld numpy      # Windows
# source .venv/bin/activate && pip install ...        # macOS / Linux
```

- `edge-tts`：主力合成与元音基准音，**必需**
- `pyworld`：只有 `vowel-tone`（单韵母四声）用得到；装不上不影响其他条目，脚本会自动退回同音汉字
- `numpy`：pyworld 的依赖，`verify_audio.py` 也要用
- `ffmpeg` / `ffprobe`：**可选**。有就做响度归一和首尾补静音，没有就跳过（脚本不会因此失败，但 `durationMs` 会是空）

`ffmpeg -version` 能出版本号即可。Windows 上 `winget install Gyan.FFmpeg` 最省事。

> 依赖统一装在项目内 `.venv`（已在 `.gitignore` 里）。不要装进系统 Python。
> 注意：`pip install --upgrade pip` 在本机会被安全删除守卫拦住，跳过这步直接装包即可。

## 2. 跑

```bash
# 全量（增量：manifest 里 sha256 一致的条目自动跳过）
.venv/Scripts/python tools/gen_audio.py --requests src/content/audio-requests.json --out public/audio/v1

# 只重生成一条 / 一批
.venv/Scripts/python tools/gen_audio.py --requests src/content/audio-requests.json --out public/audio/v1 --only d05_ju_4 --force
.venv/Scripts/python tools/gen_audio.py --requests src/content/audio-requests.json --out public/audio/v1 --only "d01_v_*" --force

# 强制全量重做
... --force
```

常用参数：

| 参数 | 说明 |
|---|---|
| `--requests` | 请求清单 JSON（数组），必填 |
| `--out` | 输出目录，例如 `public/audio/v1` |
| `--engine` | `auto`（默认）/ `edge` / `tencent` |
| `--only` | 只处理指定 key，可重复；`d01_v_*` 支持前缀通配 |
| `--force` | 忽略已有 manifest 与人工录音保护，全部重做 |
| `--jobs` | edge-tts 并发数，默认 3（调太高容易被限流） |

`audio-requests.json` 每条：

```json
[
  { "key": "d01_a_1",  "kind": "vowel-tone", "ph": "a 1",  "text": "阿", "tone": 1 },
  { "key": "d02_ba_1", "kind": "syllable",   "ph": "ba 1", "text": "八", "tone": 1 },
  { "key": "init_b",   "kind": "initial",    "ph": "b",    "text": "玻", "tone": null }
]
```

`vowel-tone` 不需要额外字段：脚本从 `ph` 取元音（`"v 3"` 会被归一成 `ü`）。
`text` 是喂给 TTS 的汉字（`vowel-tone` 用不到，脚本自己按元音选基准音）。

输出目录按 kind 分：`initial/ final/ whole/ syllable/ word/ sentence/ song/`，文件名就是 `key.mp3`。
`vowel-tone` 归到 `final/`（单韵母带调）。

## 3. 校验

```bash
.venv/Scripts/python tools/verify_audio.py --manifest public/audio/v1/manifest.json
# 报告默认写到当前目录的 audio-report.csv，可以 --csv 指定
```

看什么：

- `durationMs`：单条 250–1500ms；`word`/`sentence` 放宽到 6000ms，`song` 到 12000ms
- `headSilenceMs` / `tailSilenceMs`：≥ 60ms（脚本补 80ms 头 / 110ms 尾，mp3 编码器会吃掉 20ms 左右）
- `peakDbfs`：≥ 0.999 算削波；低于 -15dBFS 才判「没读出来」（频谱密集的音节在 -16 LUFS 下峰值本来就只有 -6~-12）
- `contourSt` / `toneMatch`：只对 `vowel-tone` 有值，六点半音轮廓，按四声的区分性特征判 yes / weak / no
- `reviewStatus` / `note`：待人耳复核的条目（多音字）会带 `pending-human` 和原因；这份 CSV 就是维护者清单，
  换真人录音时按它逐条过。界面上**不显示**这个字段

有不过条目时退出码为 1（`--lenient` 可强制 0）。**不做 ASR 反向识别**——没有可靠的离线中文 ASR，
装 whisper 的性价比远低于人工听 24 条元音。

## 4. 三种合成策略与已知局限

### 4.1 同音汉字 + edge-tts（`initial` / `final` / `whole` / `syllable` / `word` / `sentence` / `song`）

想合成 `bō` 就喂「波」。`zh-CN-XiaoyiNeural`，`rate=-20%`，主音色失败自动退 `zh-CN-XiaoxiaoNeural`。

局限：

- **edge-tts 已不支持自定义 SSML**，无法用 `<phoneme>` 指定读音，只能靠汉字间接控制
- 汉字选错就是安静的错音，TTS 不会报错 → 多音字必须人工过一遍黑名单（得 了 和 着 地 长 行 重 还 差 都 为 角 觉 乐 发 干 空 数 中 种）
- 声母必须用**呼读音**（b 读「玻」，不是「闭」也不是 /biː/），这一点错了家长第一耳就听出来
- 微软改过令牌格式导致过大面积 40317；脚本能跑但明天可能挂，这时切 `--engine tencent`

### 4.2 pyworld 改音高轮廓（`vowel-tone`，单韵母四声）

先用 edge-tts 念「啊 / 哦 / 鹅 / 衣 / 乌 / 迂」拿到基准元音，再用 pyworld
（`harvest` 提 f0 → `cheaptrick`/`d4c` 拆包络 → 替换 f0 → `synthesize` 重合成）把基频换成目标声调：

| 声调 | 五度标记 | 实现 |
|---|---|---|
| 阴平 | 55 | 全段持平 |
| 阳平 | 35 | 3 → 5 上升 |
| 上声 | 214 | 2.4 → 0.8（约 30% 处）→ 4.0 |
| 去声 | 51 | 5 → 1 下降 |

五个工程细节（都踩过）：

1. **只取有能量的浊音帧**。原始「啊」前 180ms 是起音气声，按 f0>0 取会把四分之一时长浪费在近乎无声的段上，声调轮廓会听不出来。
2. **压平幅度包络**。元音是持续音，不该保留「啊」自身的强弱起伏。
3. **帧序列按目标时长重采样**。四声给不同时长：55/35 各 0.55s，214 给 0.70s（不然降升展开不开），51 给 0.50s。
4. **五度区间约 8.8 个半音**（每级 2.2 半音），以该条自身 f0 中位数为基准。
5. 首尾 15ms 淡入淡出、峰值归一到 0.7，再交给 ffmpeg 做响度归一。

局限：

- 改写后 formant 不变（实测与基准音的频谱包络差在 2–5dB 以内），所以**元音音色取决于 TTS 念的那个汉字**；
  `o`/`e`、`i`/`ü` 是最容易混淆的两对，上线前必须人耳过一遍
- 合成器对快速下滑/回升有轻微平滑，上声的「谷底」实测比设计值浅 1–2 个半音
- `ü` 在清单里写作 `v`，脚本用 `VOWEL_ALIAS` 归一；若再出现别的写法（`u:` / `Ü`）也已覆盖，但新增写法要同步这里
- `pyworld` 需要 C 扩展；Python 3.13 有 cp313 wheel，更老的 Python 或非 x86 平台可能要自己编译，装不上就走下一条
- **任何一步失败都退回 4.1 并标记 `verified: false`**，不硬撑

### 4.3 腾讯云 TTS（`--engine tencent`，adapter 骨架）

`<speak><phoneme alphabet="py" ph="bo1">波</phoneme></speak>`，读环境变量
`TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`。

- 缺密钥时**直接跳过并提示，退出码 0**，不会把整批跑挂
- 还需要 SDK：`.venv/Scripts/pip install tencentcloud-sdk-python-tts`
- `VoiceType = 101001`（智瑜）是照文档填的，**拿到密钥后必须先用单条验证音色和 SSML 是否真的生效**，
  别直接批量跑 700 条

## 5. 和人工录音共存

`public/audio/v1/manifest.json` 里带 `sourceFile` / `kind: "human-recording"` 的条目视为人工录音，
`gen_audio.py` **默认拒绝覆盖**（打印 `SKIP … 已有录音源`）。要覆盖只能显式 `--force`。

manifest 的**顶层字段会保留**（`license` / `project` / `notes` 不会被冲掉）；这一轮如果没有合成任何条目，
manifest 一个字节都不会改（不会篡改 `voice` / `generatedAt`）。人工录音的署名不会因为跑 TTS 脚本而丢失。

### 待人工复核的多音字

`gen_audio.py` 顶部的 `PENDING_REVIEW` 是一个 key → 原因 的字典。列进去的条目会被写成
`verified: false` + `reviewStatus: "pending-human"`，`note` 里写明为什么要人听。
当前只有 `init_d`（得）与 `d02_fa_1`（发）两条——多音字读对读错由上下文决定，TTS 不会报错，只能人耳判。

人耳确认没问题后，把该 key 从 `PENDING_REVIEW` 删掉再 `--only <key> --force` 重跑一次，标注就消失了。

## 6. 后处理链（有 ffmpeg 时）

```
silenceremove(-55dB, peak) → 反转 → 再裁一次 → 反转
→ 补静态首尾（头 80ms / 尾 110ms）
→ K 加权 RMS 归一到 -16.5 dB（80Hz 高通 + 1.5kHz 高架 +4dB 后测 RMS）
   差值用 volume 施加 + alimiter=0.891 限幅，最多迭代 3 次
→ 单声道 22.05kHz / 48kbps mp3
```

头只补 80ms 是为了不突破「点击 → 出声 150ms」的延迟预算；尾部多补一点对冲 mp3 编码器的截断。

**为什么不是 loudnorm**：129 条里有一半裁完静音只剩 0.2–0.4s，短于 EBU R128 的 400ms 门控窗口，
`loudnorm` 返回 `-inf`，只能退回单遍动态模式 → 实测整批散到 10 LU（-22.8 ~ -16.4）。
K 加权 RMS 在任意时长都成立，与本机 `input_i` 实测相差 0–1.2 dB。改完后 129 条极差 0.7 dB。

**为什么不是峰值对齐**：元音波峰因数不同，把 24 条峰值拉到同一 dBFS，结果 ü 比 a 响约 9 dB
（实测：峰值对齐后 v3 平均 -8.7 dB、a3 -17.9 dB）。听感由响度决定，峰值只用来防削波——
这也是本批峰值从 -9.7 到 -0.4 dBFS 不齐的原因，属正常。

**为什么先补静音再校正**：补进去的 190ms 静音会稀释 RMS。先校正后补，结果会比目标轻约 2 dB。

`KEY_GAIN_DB` 是「个别条目在响度校正后再整体降 N dB」的名单，目前只有 `init_h` / `d02_ba_3`
（-1.2 dB，峰值留到 0.84，给播放器的淡入和音量提升留余量）。
注意别用「压低限幅门限」来实现这件事——校正循环会把增益补回来，白压；要在循环之后降整体电平。

## 7. 排查

| 现象 | 原因 / 处理 |
|---|---|
| `40317` 或连不上 | edge-tts 借用的非公开接口变了；重试最多 3 次，仍失败就等修或切腾讯云 |
| 全批 `SKIP` | 正常，sha256 与 manifest 一致；要重做加 `--force` |
| `时长异常 xxx ms` | 汉字被读成了句子（多音字/词），换字 |
| `首静音不足` | 没装 ffmpeg，原始 TTS 起音太急 |
| `pyworld 不可用，退回同音汉字` | 看 `note` 字段；常见原因是元音写法没进 `VOWEL_BASE_TEXT` / `VOWEL_ALIAS` |
| 想删掉所有产物重来 | 删 `public/audio/v1/` 与对应 manifest 即可，脚本会重建 |

`tools/_scratch/` 是本机调试用的临时目录（已 gitignore），不要往里放要提交的东西。
