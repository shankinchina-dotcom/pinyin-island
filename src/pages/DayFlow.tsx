import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { play, playOops, preload, unlockAudio } from "@/audio/player"
import { Nuonuo } from "@/components/Nuonuo"
import { toast } from "@/components/Toast"
import { buildWarmup, getItem } from "@/content"
import type { DayConfig, Item } from "@/content/types"
import { badgeByKey } from "@/data/badges"
import {
  addRead,
  addSeconds,
  finishDay,
  getState,
  recordAttempt,
  setCursor,
  todayKey,
} from "@/data/store"
import type { Mouth } from "@/three/nuonuo"

const PHASES = ["出发", "温故", "学新音", "拼一拼", "玩一关", "读一读", "收工"] as const

/** 前 3 关每一步的说明；孩子不知道做什么时，闲置后还会再弹一次 */
const PHASE_HINTS = [
  "点「出发」，看看今天要学什么。",
  "听一听，然后从四个里面点出刚才的音。",
  "点上面的声调小卡听一听，听完点「我会了」。",
  "听声音，把拼音卡放进对应的声调格子。",
  "听一听，选出声音走的是哪条滑梯。",
  "点「我读一遍」，大声读给小猫听，再点听一听对比。",
  "看看今天拿到几颗星，然后回岛上。",
] as const
const HINT_SHOW_MS = 6500
const HINT_IDLE_MS = 12000

/** 答错时小猫说的话，随机轮换，避免重复 */
const OOPS_WORDS = ["再听一次，我们一起找～", "差一点点，再听听看～", "没关系，听一次再来～"] as const

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

function makeOptions(answer: Item, pool: Item[], n = 4): Item[] {
  const same: Item[] = []
  const diff: Item[] = []
  for (const item of pool) {
    if (item.id === answer.id || item.pinyin === answer.pinyin) continue
    if (item.base === answer.base) same.push(item)
    else diff.push(item)
  }
  const candidates = [...shuffle(same).slice(0, 2), ...shuffle(diff)]
  const unique: Item[] = []
  for (const c of candidates) {
    if (unique.some((u) => u.pinyin === c.pinyin)) continue
    unique.push(c)
    if (unique.length >= n - 1) break
  }
  return shuffle([answer, ...unique])
}

const MOUTHS = new Set(["a", "o", "e", "i", "u", "v"])

function mouthFor(base: string): Mouth {
  const clean = base.replace(/[^a-z]/g, "")
  const last = clean.slice(-1)
  if (MOUTHS.has(last)) return last as Mouth
  if (MOUTHS.has(clean)) return clean as Mouth
  return "smile"
}

const TONE_LABEL = ["", "一声", "二声", "三声", "四声"]

/* ---------------- 温故 ---------------- */

function Warmup({
  items,
  pool,
  record,
  onDone,
  onHappy,
  onCurious,
}: {
  items: Item[]
  pool: Item[]
  record: (itemId: string, correct: boolean) => void
  onDone: () => void
  onHappy: () => void
  onCurious: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [wrongId, setWrongId] = useState<string | null>(null)
  const answered = useRef<Set<string>>(new Set())
  const wrongCount = useRef(0)
  const item = items[idx]
  const options = useMemo(() => makeOptions(item, pool), [item, pool])

  useEffect(() => {
    wrongCount.current = 0
    if (item) void play(item.id, { fallbackText: item.char })
  }, [item])

  if (!item) return null

  const tap = (opt: Item) => {
    if (picked) return
    if (opt.id === item.id) {
      if (!answered.current.has(item.id)) {
        answered.current.add(item.id)
        record(item.id, true)
      }
      setPicked(opt.id)
      onHappy()
      window.setTimeout(() => {
        if (idx + 1 >= items.length) onDone()
        else {
          setIdx(idx + 1)
          setPicked(null)
          setWrongId(null)
        }
      }, 720)
    } else {
      wrongCount.current += 1
      setWrongId(opt.id)
      onCurious()
      window.setTimeout(() => setWrongId(null), 620)
      if (wrongCount.current >= 3) {
        // 连错三次就亮出答案，不把这次答错计入正确率，避免孩子卡死又掉星
        setPicked(item.id)
        toast(`答案是 ${item.pinyin}，我们一起读一遍`)
        window.setTimeout(() => {
          if (idx + 1 >= items.length) onDone()
          else {
            setIdx(idx + 1)
            setPicked(null)
            setWrongId(null)
          }
        }, 1100)
        return
      }
      void play(item.id, { fallbackText: item.char })
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <span className="tiny">
          第 {idx + 1} / {items.length} 题
        </span>
        <button className="btn ghost small" onClick={() => void play(item.id, { fallbackText: item.char, rate: 0.8 })}>
          再听一遍
        </button>
      </div>
      <h2 className="h2">听一听，是哪一张？</h2>
      <div className="options">
        {options.map((opt) => {
          const isPicked = picked === opt.id
          const isWrong = wrongId === opt.id
          return (
            <button
              key={opt.id}
              className={`option ${isPicked ? "is-right" : ""} ${isWrong ? "is-wrong" : ""} ${
                picked && !isPicked ? "is-dim" : ""
              }`}
              onClick={() => tap(opt)}
            >
              {opt.pinyin}
              <span className="sub">{opt.char}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- 学新音 ---------------- */

function Learn({
  day,
  onDone,
  onMouth,
  onHappy,
}: {
  day: DayConfig
  onDone: () => void
  onMouth: (m: Mouth, tone: 1 | 2 | 3 | 4) => void
  onHappy: () => void
}) {
  const [gi, setGi] = useState(0)
  const [sel, setSel] = useState(0)
  const group = day.newGroups[gi] ?? day.newGroups[0]
  const items = useMemo(
    () => group.ids.map((id) => getItem(id)).filter((x): x is Item => !!x),
    [group],
  )
  const item = items[sel] ?? items[0]

  useEffect(() => {
    if (item) onMouth(mouthFor(item.base), (item.tone || 1) as 1 | 2 | 3 | 4)
  }, [item, onMouth])

  if (!item) return null

  const next = () => {
    if (gi + 1 >= day.newGroups.length) onDone()
    else {
      setGi(gi + 1)
      setSel(0)
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <span className="tiny">
          第 {gi + 1} / {day.newGroups.length} 组
        </span>
        <span className="tiny">{group.hint}</span>
      </div>

      <div className="center" style={{ gap: 12 }}>
        <span className="pinyin" style={{ fontSize: "clamp(56px, 12vw, 96px)" }}>
          {item.pinyin}
        </span>
        <span className="tiny">{item.examplePinyin ? `${item.examplePinyin} ` : ""}{item.char}</span>
        {item.tip && <span className="lip-badge">{item.tip}</span>}
      </div>

      <div className="chip-row">
        {items.map((it, i) => (
          <button
            key={it.id}
            className={`tone-chip ${i === sel ? "on" : ""}`}
            onClick={() => {
              setSel(i)
              onHappy()
              void play(it.id, { fallbackText: it.char })
            }}
          >
            {it.pinyin}
            <span className="tone-no">{it.tone ? TONE_LABEL[it.tone] : "轻声"}</span>
          </button>
        ))}
      </div>

      <div className="row" style={{ justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
        <button className="btn mist small" onClick={() => void play(item.id, { fallbackText: item.char, rate: 0.8 })}>
          慢速听
        </button>
        <button className="btn small" onClick={() => void play(item.id, { fallbackText: item.char })}>
          常速听
        </button>
      </div>

      <button className="btn primary" onClick={next} style={{ alignSelf: "center", minWidth: 220 }}>
        {gi + 1 >= day.newGroups.length ? "都听过了" : "我会了，下一个"}
      </button>
    </div>
  )
}

/* ---------------- 拼一拼 ---------------- */

function BuildCombine({ day, onDone, onHappy }: { day: DayConfig; onDone: () => void; onHappy: () => void }) {
  const [ti, setTi] = useState(0)
  const [picked, setPicked] = useState({ i: false, f: false })
  const task = day.buildTasks[ti]
  const merged = picked.i && picked.f

  useEffect(() => {
    setPicked({ i: false, f: false })
  }, [ti])

  useEffect(() => {
    if (merged && task) {
      onHappy()
      void play(task.itemId, { fallbackText: task.char })
    }
  }, [merged, task, onHappy])

  if (!task) return null

  return (
    <div className="stack">
      <div className="row between">
        <span className="tiny">
          第 {ti + 1} / {day.buildTasks.length} 组
        </span>
        <span className="tiny">先点声母，再点韵母</span>
      </div>
      <h2 className="h2">把它们拼起来</h2>

      <div className="merge-row">
        <button
          className={`merge-card ${picked.i ? "sel" : ""}`}
          onClick={() => {
            setPicked((p) => ({ ...p, i: true }))
            void play(`init_${task.initial}`, { fallbackText: task.initial })
          }}
        >
          {task.initial}
        </button>
        <span className="merge-plus">+</span>
        <button
          className={`merge-card ${picked.f ? "sel" : ""}`}
          onClick={() => {
            setPicked((p) => ({ ...p, f: true }))
            void play(`fin_${task.final}`, { fallbackText: task.final })
          }}
        >
          {task.final}
        </button>
        <span className="merge-plus">=</span>
        <div className={`merge-result ${merged ? "filled" : ""}`}>{merged ? task.result : "?"}</div>
      </div>

      {merged && (
        <div className="center fade-up">
          <span className="tiny">{task.char}</span>
          <button
            className="btn primary"
            onClick={() => {
              if (ti + 1 >= day.buildTasks.length) onDone()
              else setTi(ti + 1)
            }}
          >
            {ti + 1 >= day.buildTasks.length ? "拼完了" : "下一组"}
          </button>
        </div>
      )}
      {!merged && (
        <p className="muted center" style={{ textAlign: "center" }}>
          两张卡片碰在一起，就会发出一个声音。
        </p>
      )}
    </div>
  )
}

function BuildTone({ day, onDone, onHappy, onCurious }: { day: DayConfig; onDone: () => void; onHappy: () => void; onCurious: () => void }) {
  const [gi, setGi] = useState(0)
  const group = day.newGroups[gi] ?? day.newGroups[0]
  const items = useMemo(
    () => group.ids.map((id) => getItem(id)).filter((x): x is Item => !!x),
    [group],
  )
  const cards = useMemo(() => shuffle(items), [items])
  // 四个声调的出现顺序每次重新洗牌，避免孩子背「1-2-3-4」而不是听音
  const [order, setOrder] = useState<number[]>(() => shuffle([1, 2, 3, 4]))
  const [placed, setPlaced] = useState<number[]>([])
  const target = order[placed.length] ?? 4
  const current = order[placed.length]

  useEffect(() => {
    const it = items.find((x) => x.tone === current)
    if (it) void play(it.id, { fallbackText: it.char })
  }, [current, items])

  const tap = (it: Item) => {
    if (it.tone === target) {
      onHappy()
      const nextPlaced = [...placed, it.tone]
      setPlaced(nextPlaced)
      if (nextPlaced.length >= 4) {
        window.setTimeout(() => {
          if (gi + 1 >= day.newGroups.length) onDone()
          else {
            setGi(gi + 1)
            setPlaced([])
            setOrder(shuffle([1, 2, 3, 4]))
          }
        }, 900)
      }
    } else {
      onCurious()
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <span className="tiny">
          第 {gi + 1} / {day.newGroups.length} 组
        </span>
        <span className="tiny">现在找 {TONE_LABEL[target]}</span>
      </div>
      <h2 className="h2">听一听，把它放进对应的格子</h2>
      <div className="tone-slots">
        {[1, 2, 3, 4].map((t) => (
          <div key={t} className={`tone-slot ${placed.includes(t) ? "on" : ""}`}>
            {TONE_LABEL[t]}
          </div>
        ))}
      </div>
      <div className="options">
        {cards.map((it) => (
          <button
            key={it.id}
            className={`option ${placed.includes(it.tone) ? "is-dim" : ""}`}
            onClick={() => tap(it)}
            disabled={placed.includes(it.tone)}
          >
            {it.pinyin}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 玩一关 ---------------- */

function GameRound({
  day,
  record,
  onDone,
  onHappy,
  onCurious,
}: {
  day: DayConfig
  record: (itemId: string, correct: boolean) => void
  onDone: () => void
  onHappy: () => void
  onCurious: () => void
}) {
  const rounds = useMemo(() => {
    const pool = day.items.filter((i) => i.tone > 0)
    const list = Array.from({ length: 8 }, () => pool[Math.floor(Math.random() * pool.length)]).filter(Boolean)
    // 避免连续三题同一声调，也避免同一张卡连着出现
    for (let i = 2; i < list.length; i++) {
      const sameTone = list[i].tone === list[i - 1].tone && list[i].tone === list[i - 2].tone
      const sameCard = list[i].id === list[i - 1].id
      if (sameTone || sameCard) {
        const j = list.findIndex((x, idx) => idx > i && x.tone !== list[i].tone && x.id !== list[i].id)
        if (j > -1) {
          const t = list[i]
          list[i] = list[j]
          list[j] = t
        }
      }
    }
    return list
  }, [day])
  const [ri, setRi] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [wrongId, setWrongId] = useState<string | null>(null)
  const answered = useRef<Set<number>>(new Set())
  const item = rounds[ri]
  const options = useMemo(() => (item ? makeOptions(item, day.items) : []), [item, day])

  useEffect(() => {
    if (item) void play(item.id, { fallbackText: item.char })
  }, [item])

  if (!item) return null

  const advance = () => {
    window.setTimeout(() => {
      if (ri + 1 >= rounds.length) onDone()
      else {
        setRi(ri + 1)
        setPicked(null)
        setWrongId(null)
      }
    }, 680)
  }

  const tapTone = (tone: number) => {
    if (picked) return
    if (tone === item.tone) {
      if (!answered.current.has(ri)) {
        answered.current.add(ri)
        record(item.id, true)
      }
      setPicked(`t${tone}`)
      onHappy()
      advance()
    } else {
      if (!answered.current.has(ri)) {
        answered.current.add(ri)
        record(item.id, false)
      }
      setWrongId(`t${tone}`)
      onCurious()
      void play(item.id, { fallbackText: item.char })
      window.setTimeout(() => setWrongId(null), 600)
    }
  }

  const tapCard = (opt: Item) => {
    if (picked) return
    if (opt.id === item.id) {
      if (!answered.current.has(ri)) {
        answered.current.add(ri)
        record(item.id, true)
      }
      setPicked(opt.id)
      onHappy()
      advance()
    } else {
      if (!answered.current.has(ri)) {
        answered.current.add(ri)
        record(item.id, false)
      }
      setWrongId(opt.id)
      onCurious()
      void play(item.id, { fallbackText: item.char })
      window.setTimeout(() => setWrongId(null), 600)
    }
  }

  if (day.game === "tone-slide") {
    const shapes = ["M6 30 H54", "M6 46 C 24 46, 34 12, 54 12", "M6 16 C 22 44, 32 44, 40 20 C 46 6, 50 12, 54 24", "M6 12 C 26 16, 40 34, 54 48"]
    const ends: [number, number][] = [[54, 30], [54, 12], [54, 24], [54, 48]]
    return (
      <div className="stack">
        <div className="row between">
          <span className="tiny">
            第 {ri + 1} / {rounds.length} 关
          </span>
          <span className="tiny">听声音，选滑梯</span>
        </div>
        <h2 className="h2">这个声音走哪条滑梯？</h2>
        <div className="slopes">
          {[1, 2, 3, 4].map((t) => (
            <button
              key={t}
              className={`slope ${picked === `t${t}` ? "on" : ""} ${wrongId === `t${t}` ? "is-wrong" : ""}`}
              onClick={() => tapTone(t)}
            >
              <svg viewBox="0 0 60 56" fill="none" aria-hidden>
                <path d={shapes[t - 1]} stroke="#6B5B57" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
                <circle cx={ends[t - 1][0]} cy={ends[t - 1][1]} r="4" fill="#FFB9C4" />
              </svg>
              {TONE_LABEL[t]}
            </button>
          ))}
        </div>
        <button className="btn ghost small" style={{ alignSelf: "center" }} onClick={() => void play(item.id, { fallbackText: item.char, rate: 0.8 })}>
          再听一遍
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="row between">
        <span className="tiny">
          第 {ri + 1} / {rounds.length} 关
        </span>
        <span className="tiny">{day.game === "fog" ? "吹开雾，找字母" : "钓到听到的那一个"}</span>
      </div>
      <h2 className="h2">{day.game === "fog" ? "雾团把字母藏起来了" : "池塘里是哪一张？"}</h2>
      <div className="options">
        {options.map((opt) => {
          const isPicked = picked === opt.id
          const isWrong = wrongId === opt.id
          return (
            <button
              key={opt.id}
              className={`option ${day.game === "fog" ? "fog-card revealed" : "fish"} ${isPicked ? "is-right" : ""} ${
                isWrong ? "is-wrong" : ""
              } ${picked && !isPicked ? "is-dim" : ""}`}
              onClick={() => tapCard(opt)}
            >
              {opt.pinyin}
            </button>
          )
        })}
      </div>
      <button className="btn ghost small" style={{ alignSelf: "center" }} onClick={() => void play(item.id, { fallbackText: item.char })}>
        再听一遍
      </button>
    </div>
  )
}

/* ---------------- 读一读 ---------------- */

function ReadStep({ day, childId, onDone }: { day: DayConfig; childId: string; onDone: () => void }) {
  const items = useMemo(
    () => day.readIds.map((id) => getItem(id)).filter((x): x is Item => !!x),
    [day],
  )
  const [idx, setIdx] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const item = items[idx]
  const reads = getState().progress[childId]?.reads[item?.id ?? ""] ?? 0
  const todayCount = useMemo(() => {
    const p = getState().progress[childId]
    return Object.values(p?.readsByDate[todayKey()] ?? {}).reduce((a, b) => a + b, 0)
  }, [childId, url, recording, idx])

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  if (!item) return null

  const startRec = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicOn(false)
      toast("这台设备没有麦克风，我们改成听读打卡")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      recRef.current = rec
      chunks.current = []
      rec.ondataavailable = (e) => chunks.current.push(e.data)
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" })
        const audioUrl = URL.createObjectURL(blob)
        setUrl(audioUrl)
        stream.getTracks().forEach((t) => t.stop())
        // 读完立刻放给自己听，不用再点一次「听我的」
        void new Audio(audioUrl).play().catch(() => {
          toast("没自动放出来，点「听我的」也能听")
        })
      }
      rec.start()
      setRecording(true)
      window.setTimeout(() => {
        if (rec.state === "recording") {
          rec.stop()
          setRecording(false)
        }
      }, 3000)
    } catch {
      setMicOn(false)
      toast("没有拿到麦克风权限，我们改成听读打卡")
    }
  }

  const next = () => {
    if (idx + 1 >= items.length) onDone()
    else {
      setIdx(idx + 1)
      setUrl(null)
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <span className="tiny">
          第 {idx + 1} / {items.length} 个
        </span>
        <span className="counter">今天已读 {todayCount} 遍</span>
      </div>

      <div className="word-card">
        <div className="word">{item.pinyin}</div>
        <div className="char">{item.char}</div>
      </div>

      <div className="record-row">
        <button className="btn mist small" onClick={() => void play(item.id, { fallbackText: item.char })}>
          听标准音
        </button>
        <button
          className="btn small"
          onClick={() => {
            if (!micOn) {
              toast("这台设备没有录音，听完标准音自己读一遍，再点下面的打卡")
              void play(item.id, { fallbackText: item.char })
              return
            }
            if (recording) {
              recRef.current?.stop()
              setRecording(false)
            } else {
              void startRec()
            }
          }}
        >
          {recording ? (
            <>
              <span className="recording-dot" />正在听…
            </>
          ) : (
            "我读一遍"
          )}
        </button>
        {url && (
          <button className="btn small" onClick={() => void new Audio(url).play()}>
            听我的
          </button>
        )}
      </div>

      <div className="center" style={{ gap: 10 }}>
        <button
          className="btn honey"
          onClick={() => {
            addRead(childId, item.id)
            toast("记下了，再读一遍也可以")
          }}
        >
          读了一遍 +1
        </button>
        <span className="tiny">本词一共读过 {reads} 遍</span>
      </div>

      <button className="btn ghost small" style={{ alignSelf: "center" }} onClick={next}>
        {idx + 1 >= items.length ? "读完了" : "下一个"}
      </button>
    </div>
  )
}

/* ---------------- 结算 ---------------- */

function Finish({
  day,
  stars,
  badges,
  onExit,
  onAgain,
}: {
  day: DayConfig
  stars: number
  badges: string[]
  onExit: () => void
  onAgain: () => void
}) {
  const closing = day.closings[Math.floor(Math.random() * day.closings.length)]
  return (
    <div className="center fade-up" style={{ gap: 22, padding: "10px 0" }}>
      <div className="stars-big">
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= stars ? "star-on" : "star-off"}>
            ★
          </span>
        ))}
      </div>
      <h2 className="h2">{stars >= 3 ? "今天三颗星，全拿到了" : stars === 2 ? "两颗星，很不错" : "一颗星，也是进步"}</h2>
      <p className="muted" style={{ maxWidth: 420 }}>
        {closing}
      </p>

      {badges.length > 0 && (
        <div className="badge-grid" style={{ width: "100%" }}>
          {badges.map((key) => {
            const b = badgeByKey(key)
            if (!b) return null
            return (
              <div className="badge-card owned" key={key}>
                <div className="badge-ico">{b.ico}</div>
                <span>{b.name}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="row wrap" style={{ justifyContent: "center" }}>
        <button className="btn primary" onClick={onExit}>
          回到拼音岛
        </button>
        <button className="btn ghost small" onClick={onAgain}>
          再读一遍
        </button>
      </div>
    </div>
  )
}

/* ---------------- 主流程 ---------------- */

/** 任务卡右上角的小猫 speaker：SVG 程序化生成，带轻微摆动 */
function CatAsk({ text, oops = false }: { text: string; oops?: boolean }) {
  return (
    <div className={`cat-ask ${oops ? "is-oops" : ""}`} role="status">
      <svg className="cat-ask-face" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <clipPath id="cat-ask-clip"><circle cx="32" cy="35" r="23" /></clipPath>
        </defs>
        <path d="M10 27 L8 5 L25 18 Z" fill="#6E5B52" />
        <path d="M54 27 L56 5 L39 18 Z" fill="#F3B47C" />
        <path d="M14 25 L14 11 L23 19 Z" fill="#FFC9CF" />
        <path d="M50 25 L50 11 L41 19 Z" fill="#FFC9CF" />
        <circle cx="32" cy="35" r="23" fill="#FFF7EC" />
        <g clipPath="url(#cat-ask-clip)">
          <circle cx="13" cy="19" r="15" fill="#6E5B52" />
          <circle cx="52" cy="17" r="14" fill="#F3B47C" />
        </g>
        <circle cx="24" cy="35" r="3.4" fill="#4A3B36" />
        <circle cx="40" cy="35" r="3.4" fill="#4A3B36" />
        <circle cx="25" cy="34" r="1.1" fill="#fff" />
        <circle cx="41" cy="34" r="1.1" fill="#fff" />
        <path d="M29 42 Q32 45 35 42" stroke="#EF9AA6" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="18" cy="41" r="3" fill="#FFB7C0" opacity="0.65" />
        <circle cx="46" cy="41" r="3" fill="#FFB7C0" opacity="0.65" />
      </svg>
      <div className="cat-ask-bubble">{text}</div>
    </div>
  )
}

export function DayFlow({
  day,
  childId,
  onExit,
}: {
  day: DayConfig
  childId: string
  onExit: () => void
}) {
  const [phase, setPhase] = useState(() => {
    if (!import.meta.env.DEV) return 0
    const q = Number(new URLSearchParams(window.location.search).get("phase") ?? 0)
    return Number.isFinite(q) ? Math.min(6, Math.max(0, q)) : 0
  })
  const [mouth, setMouth] = useState<Mouth>("smile")
  const [mood, setMood] = useState<"idle" | "happy" | "surprised" | "curious">("idle")
  const [bubble, setBubble] = useState<string | null>(null)
  const bubbleTimer = useRef(0)
  const [tone, setTone] = useState<1 | 2 | 3 | 4>(1)
  const [action, setAction] = useState<"nod" | "clap" | "jump" | "wave" | "shake">("nod")
  const [actionKey, setActionKey] = useState(0)
  const totals = useRef({ attempts: 0, correct: 0 })
  const [result, setResult] = useState<{ stars: number; badges: string[] } | null>(null)

  // 引导提示：只在第 1–3 关出现；进入每一步先弹一次，之后闲置 12 秒再弹
  const [hintOn, setHintOn] = useState(false)
  const hideTimer = useRef(0)
  const idleTimer = useRef(0)
  const showHint = useCallback(() => {
    if (day.day > 3) return
    setHintOn(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHintOn(false), HINT_SHOW_MS)
  }, [day.day])
  const touched = useCallback(() => {
    if (day.day > 3) return
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(showHint, HINT_IDLE_MS)
  }, [day.day, showHint])

  useEffect(() => {
    showHint()
    touched()
    return () => {
      window.clearTimeout(hideTimer.current)
      window.clearTimeout(idleTimer.current)
      window.clearTimeout(bubbleTimer.current)
    }
  }, [phase, showHint, touched])

  const warmup = useMemo(() => buildWarmup(day), [day])
  const pool = useMemo(() => {
    const prev = day.day > 1 ? buildWarmup(day) : []
    return [...day.items, ...prev]
  }, [day])

  useEffect(() => {
    void unlockAudio()
    void preload(day.items.map((i) => i.id))
  }, [day])

  useEffect(() => {
    const t = window.setInterval(() => addSeconds(childId, 15), 15000)
    return () => window.clearInterval(t)
  }, [childId])

  useEffect(() => {
    setCursor(childId, day.day, { step: phase, index: 0 })
  }, [childId, day.day, phase])

  useEffect(() => {
    if (phase !== 6 || result) return
    const acc = totals.current.attempts > 0 ? totals.current.correct / totals.current.attempts : 1
    const p = getState().progress[childId]
    const reads = Object.values(p?.readsByDate[todayKey()] ?? {}).reduce((a, b) => a + b, 0)
    const earned = 1 + (acc >= 0.8 ? 1 : 0) + (reads >= 5 ? 1 : 0)
    const r = finishDay(childId, day.day, earned)
    setResult({ stars: earned, badges: r.newBadges })
  }, [phase, result, childId, day.day])

  const happy = useCallback(() => {
    setMood("happy")
    setAction("jump")
    setActionKey((k) => k + 1)
    window.setTimeout(() => setMood("idle"), 900)
  }, [])

  const curious = useCallback(() => {
    setMood("curious")
    setAction("shake")
    setActionKey((k) => k + 1)
    setBubble(OOPS_WORDS[Math.floor(Math.random() * OOPS_WORDS.length)])
    playOops()
    window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => {
      setBubble(null)
      setMood("idle")
    }, 1900)
  }, [])

  const record = useCallback(
    (itemId: string, correct: boolean) => {
      recordAttempt(childId, itemId, day.day, correct)
      totals.current.attempts += 1
      if (correct) totals.current.correct += 1
    },
    [childId, day.day],
  )

  const setMouthFromLearn = useCallback((m: Mouth, t: 1 | 2 | 3 | 4) => {
    setMouth(m)
    setTone(t)
  }, [])

  const go = (n: number) => {
    setMouth("smile")
    setPhase(n)
  }

  return (
    <div
      className="shell"
      style={{ paddingTop: 10 }}
      onPointerDown={touched}
      onKeyDown={touched}
    >
      <header className="step-head">
        <button className="icon-btn" onClick={onExit} aria-label="回到地图">
          ←
        </button>
        <div className="grow">
          <div className="tiny">
            第 {day.day} 关 · {day.theme}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <span className="tiny">{PHASES[phase]}</span>
            <div className="progress-dots">
              {PHASES.map((p, i) => (
                <span key={p} className={`dot ${i === phase ? "on" : i < phase ? "done" : ""}`} />
              ))}
            </div>
          </div>
        </div>
        <span className="tiny">12 分钟</span>
      </header>

      {day.day <= 3 && (bubble || hintOn) && (
        <CatAsk text={bubble ?? PHASE_HINTS[phase]} oops={!!bubble} />
      )}

      <div className="desk-split">
        <div className="stack col-aside">
          <div className="card soft cat-card">
            <Nuonuo
              mouth={mouth}
              mood={mood}
              tone={tone}
              action={action}
              actionKey={actionKey}
              height={320}
            />
            <p className="tiny" style={{ textAlign: "center", marginTop: 8 }}>
              {mood === "happy" ? "听见了，读得真好" : "我在这儿陪你读"}
            </p>
          </div>
          <div className="card soft stack" style={{ gap: 8 }}>
            <span className="tiny">今天的音</span>
            <div className="chip-row" style={{ justifyContent: "flex-start" }}>
              {day.newGroups.map((g) => (
                <span className="sea-chip" key={g.label}>
                  {g.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="card flow-card">
          {phase === 0 && (
            <div className="center" style={{ gap: 18 }}>
              <span className="tiny">第 {day.day} 关</span>
              <h1 className="h1">{day.theme}</h1>
              <p className="muted" style={{ maxWidth: 420 }}>
                {day.intro}
              </p>
              <div className="chip-row">
                {day.goals.map((g) => (
                  <span className="sea-chip" key={g}>
                    {g}
                  </span>
                ))}
              </div>
              <button className="btn primary" onClick={() => go(1)} style={{ minWidth: 220 }}>
                出发
              </button>
            </div>
          )}

          {phase === 1 && (
            <Warmup
              items={warmup}
              pool={pool}
              record={record}
              onDone={() => go(2)}
              onHappy={happy}
              onCurious={curious}
            />
          )}

          {phase === 2 && (
            <Learn
              day={day}
              onDone={() => go(3)}
              onHappy={happy}
              onMouth={setMouthFromLearn}
            />
          )}

          {phase === 3 &&
            (day.buildKind === "combine" ? (
              <BuildCombine day={day} onDone={() => go(4)} onHappy={happy} />
            ) : (
              <BuildTone day={day} onDone={() => go(4)} onHappy={happy} onCurious={curious} />
            ))}

          {phase === 4 && (
            <GameRound day={day} record={record} onDone={() => go(5)} onHappy={happy} onCurious={curious} />
          )}

          {phase === 5 && <ReadStep day={day} childId={childId} onDone={() => go(6)} />}

          {phase === 6 && result && (
            <Finish
              day={day}
              stars={result.stars}
              badges={result.badges}
              onExit={onExit}
              onAgain={() => {
                totals.current = { attempts: 0, correct: 0 }
                setResult(null)
                go(0)
              }}
            />
          )}

          {phase === 6 && !result && <p className="muted">正在把今天记下来…</p>}
        </div>
      </div>

      <div className="card soft" style={{ marginTop: 20 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {PHASES.map((p, i) => (
            <span key={p} className={`sea-chip ${i === phase ? "on" : ""}`}>
              {i + 1} · {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
