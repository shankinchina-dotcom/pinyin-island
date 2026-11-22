# 音频来源与生成记录

本目录下的 mp3 **全部为机器合成**，不含任何第三方录音素材。
生成脚本：`tools/gen_audio.py`　校验脚本：`tools/verify_audio.py`

## 生成批次

| 项 | 值 |
|---|---|
| 批次版本 | v1 |
| 生成日期 | 2026-11-21 |
| 条目数 | 129（manifest.json 全量） |
| 总体积 | 511 KB（mp3 合计 523,587 B） |
| 音频格式 | MP3 单声道 22.05 kHz / 48 kbps |
| 合成引擎 | edge-tts 7.3.1（微软 Edge 在线朗读接口） |
| 音色 | `zh-CN-XiaoyiNeural`（备用：`zh-CN-XiaoxiaoNeural`） |
| 语速 | `-20%` |
| 响度 | K 加权 RMS -16.5 dB（等价 -16 LUFS），实测 129 条极差 0.7 dB |
| 峰值 | -9.7 ~ -1.4 dBFS（不统一，见「已知局限」第 4 条） |

## 三类来源，按条目区分

判断方法：看 `manifest.json` 里该条的 `note` 字段。

| 来源 | 条数 | manifest 标记 | 说明 |
|---|---|---|---|
| 同音汉字 + edge-tts | 105 | `note` 为空 | 想合成 `bō` 就朗读「波」，靠汉字间接控制读音。`initial` 23 / `final` 24 / `whole` 16 / `syllable` 32 / `word` 10 |
| pyworld 改写声调 | 24 | `note: "pyworld 声调轮廓"` | 单韵母四声（`d01_a_1` … `d01_v_4`）。先由 edge-tts 念基准元音（啊/哦/鹅/衣/乌/迂），再用 pyworld 把 f0 替换成五度标记 55/35/214/51 的轮廓后重合成 |
| 腾讯云 TTS | 0 | `engine: "tencent-tts"` | 本批次未使用（无密钥）。adapter 已在脚本里留好 |

engine 字段一律为 `edge-tts`：pyworld 那 24 条只是改写了 edge-tts 输出的音高，音色仍是 `zh-CN-XiaoyiNeural`。

## 后处理链

```
裁首尾静音(-55dB, peak)
→ K 加权 RMS 归一到 -16.5 dB（80Hz 高通 + 1.5kHz 高架 +4dB 后测 RMS）
   → 差值用 volume 施加，alimiter 限到 -1dBFS，最多迭代 3 次
→ 尾部补 110ms、头部补 80ms 静音
→ 单声道 22.05kHz / 48kbps mp3
```

头部 80ms 是刻意留的缓冲，用于「点击 → 出声 150ms」预算；尾部 110ms 是对冲 mp3 编码器的截断。

**为什么不用 loudnorm 的积分响度**：本批 129 条里有一半裁完静音只剩 0.2–0.4s，
低于 EBU R128 的 400ms 门控窗口，`loudnorm` 直接返回 `-inf`，只能退回单遍动态模式，
结果 129 条散到 10 LU。K 加权 RMS 在任意时长都成立，且实测与 `input_i` 只差 0–1.2 dB。

## 校验结果

`verify_audio.py` 全量跑：**129/129 通过**（时长、首尾静音、峰值、空文件）。
24 条单韵母四声的 f0 轮廓全部判定 `yes`（1 平 / 2 升 / 3 降升 / 4 降）。
响度：129 条 K 加权 RMS 极差 0.7 dB（-16.4 ~ -15.7）；其中 118 条可测积分响度，极差 2.3 LU。
报告见 `tools/audio-report.csv`（构建产物，不入库）。

**未完成人工复核的条目**：`init_d`（「得」）与 `d02_fa_1`（「发」）为多音字，
合成结果**尚未人耳复核**，两条已标 `verified: false` + `reviewStatus: "pending-human"`。
复核人：______　复核日期：______　结论：______

## 已知局限 / 待人工复核

1. **`o` vs `e`、`i` vs `ü` 两对最容易混**，上线前必须人耳过一遍，尤其 `d01_o_*` 与 `d01_e_*`
2. **多音字 2 条已标 `reviewStatus: "pending-human"` + `verified: false`**：
   - `init_d` 用「得」（教材标准呼读音用字；读成 dé 可接受，读成 děi 才是问题）
   - `d02_fa_1` 用「发」（fā 没有可替换的常用同音字）
   这两条技术指标全过，只是读音对错机器判不了。改法见 `tools/README.md` 的 `PENDING_REVIEW`
3. 上声（三声）的谷底实测比设计值浅 1~2 个半音，听感上仍是降升，但不排除个别偏「平」
4. **峰值不统一（-9.7 ~ -0.4 dBFS）是刻意的**：响度已经对齐，峰值差异来自各音节波峰因数不同
   （鼻韵母/单韵母频谱密集，峰值天然低）。**不要**改成按峰值对齐，那样 ü 会比 a 响约 9 dB。
   最热的 2 条（`init_h`、`d02_ba_3`）额外整体降了 1.2 dB，峰值 0.84（-1.5 dBFS），
   给播放器的淡入/音量提升留余量——代价是这两条比其余轻约 1.2 dB，属于刻意取舍
5. edge-tts 借用的是非公开接口，微软改过令牌格式导致过大面积 40317。本批次生成时正常

## 版权与合规

- 音频由微软在线朗读服务合成，**未使用**任何外部录音、歌曲或第三方音频库；本目录自建立起就没有引入过 CC BY-SA 之类的素材
- 本批次只覆盖 `initial` / `final` / `whole` / `syllable` / `word` 五类，还没有 `sentence`（第 21–23 天）与 `song`（《尾巴歌》5 段）
- 对外发布（尤其商用）前，需自行确认所用 TTS 服务的条款是否允许该用途

## 换音色 / 重生成

改 `tools/gen_audio.py` 顶部的 `VOICE`，然后全量重做（`--force`）：

```bash
.venv/Scripts/python tools/gen_audio.py --requests src/content/audio-requests.json --out public/audio/v1 --force
.venv/Scripts/python tools/verify_audio.py --manifest public/audio/v1/manifest.json
```

`manifest.json` 每条都带 `voice` / `rate` / `engine` / `generatedAt` / `sha256`，换音色后逐条可追溯。
改完记得更新本文件「生成批次」表里的音色与日期。


## 补充：24 条单韵母四声改用真人录音（2026-11-21）

- 来源：`audio-cmn`（https://github.com/hugolpz/audio-cmn），录音 Chen Wang
- 许可：**CC BY-SA**（署名 + 相同方式共享）
- 条目：`d01_{a,o,e,i,u,v}_{1..4}`，共 24 条
- 原始文件：`cmn-{a,o,e,yi,wu,yu}{1..4}.mp3`（i/u/ü 用零声母 yi/wu/yu 录音）
- 处理：ffmpeg 裁首尾静音 → loudnorm -16 LUFS → 头补 80ms / 尾补 110ms → 22.05kHz 单声道 48kbps
- 备份：原 TTS+pyworld 版本留在 `tools/_backup_tts/`，可 A/B 对比
- 状态：`verified: false`，`reviewStatus: pending-teacher-review`，需人耳与教材音对照

> 注意：CC BY-SA 要求署名并相同方式共享。若本站公开发布，需在页面「关于」中保留本署名。

## 第二批：105 条 TTS 换为真人录音（2026-11-21）

- 覆盖范围：`initial` 23、`final` 23、`whole` 16、`syllable` 32、`word` 10、`vowel-tone` 24（此前已完成）
- 来源：`audio-cmn`（https://github.com/hugolpz/audio-cmn），录音 Chen Wang，许可 **CC BY-SA**
- 词语为逐字拼接（`human-recording-concat`），其余为整条真人录音
- 处理：裁首尾静音 → loudnorm -16 LUFS → 头补 80ms / 尾补 110ms → 22.05kHz 单声道 48kbps
- 结果：129 条中 **128 条真人**，仅 `fin_ong` 保留合成
- `fin_ong` 例外原因：普通话 `ong` 不能独立成音节，两个上游数据源均无 `ong` 单音录音；用 `weng` 替代会造成听感错误，故不替换
- 全部人声条目 `verified: false` / `reviewStatus: pending-teacher-review`，尚未逐条人耳复核

> CC BY-SA 要求署名并以相同方式共享。若公开发布，页面「关于」处需保留本署名。
