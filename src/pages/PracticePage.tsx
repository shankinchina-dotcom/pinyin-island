import { useState } from "react"
import { play, unlockAudio } from "@/audio/player"
import { toast } from "@/components/Toast"
import { PHONEMES } from "@/content"

type TabKey = "initial" | "final" | "whole"

const TABS: { key: TabKey; label: string }[] = [
  { key: "initial", label: "声母" },
  { key: "final", label: "韵母" },
  { key: "whole", label: "整体认读" },
]

const PAIRS: [string, string, string][] = [
  ["init_b", "init_p", "b / p 送气"],
  ["init_d", "init_t", "d / t 送气"],
  ["init_n", "init_l", "n / l 鼻音"],
  ["fin_an", "fin_ang", "an / ang"],
  ["fin_en", "fin_eng", "en / eng"],
  ["fin_in", "fin_ing", "in / ing"],
]

export function PracticePage() {
  const [tab, setTab] = useState<TabKey>("initial")
  const list = PHONEMES.filter((p) => p.kind === tab)

  const say = async (id: string, char: string) => {
    await unlockAudio()
    void play(id, { fallbackText: char })
  }

  return (
    <div className="shell stack lg" style={{ paddingTop: 12 }}>
      <div className="stack" style={{ gap: 8 }}>
        <h1 className="h1">自由练习</h1>
        <p className="muted">想读哪个就点哪个。点一下，它就出声。</p>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="wall">
        {list.map((p) => (
          <button key={p.id} className="wall-cell" onClick={() => void say(p.id, p.char)} title={p.tip}>
            {p.pinyin}
          </button>
        ))}
      </div>

      <div className="card soft stack">
        <h3 className="h3">最容易混的几对</h3>
        <p className="tiny">点一下，会先读左边，再读右边。听完可以让小朋友说哪两个不一样。</p>
        <div className="chip-row" style={{ justifyContent: "flex-start" }}>
          {PAIRS.map(([a, b, label]) => (
            <button
              key={label}
              className="btn ghost small"
              onClick={() => {
                const pa = PHONEMES.find((p) => p.id === a)
                const pb = PHONEMES.find((p) => p.id === b)
                if (!pa || !pb) return
                void (async () => {
                  await unlockAudio()
                  await play(pa.id, { fallbackText: pa.char })
                  await play(pb.id, { fallbackText: pb.char })
                })()
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="tiny">eng / ong 目前是近似音，等换上人工录音会更准。</p>
      </div>

      <button
        className="btn honey"
        style={{ alignSelf: "center" }}
        onClick={() => {
          toast("点读墙先把 63 个音认全，再进关卡会更快")
        }}
      >
        读完了，去闯关
      </button>
    </div>
  )
}
