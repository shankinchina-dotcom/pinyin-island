import daysFile from "./days.json"
import phonemesFile from "./phonemes.json"
import type { DayConfig, DaysFile, Item, Phoneme } from "./types"

export const DAYS: DayConfig[] = (daysFile as unknown as DaysFile).days
export const PHONEMES: Phoneme[] = phonemesFile as Phoneme[]

const itemMap = new Map<string, Item>()
for (const day of DAYS) {
  for (const item of day.items) itemMap.set(item.id, item)
}

const phonemeMap = new Map<string, Phoneme>()
for (const p of PHONEMES) phonemeMap.set(p.id, p)

export function getItem(id: string): Item | undefined {
  return itemMap.get(id)
}

export function getPhoneme(id: string): Phoneme | undefined {
  return phonemeMap.get(id)
}

export function getDay(day: number): DayConfig | undefined {
  return DAYS.find((d) => d.day === day)
}

/** 取某个 item 的例字，音频回退时用 */
export function textOf(id: string): string {
  return itemMap.get(id)?.char ?? phonemeMap.get(id)?.char ?? ""
}

/** 洗牌 */
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

/** 避免连续三个同一属性（比如连着三道都是四声） */
function avoidRuns<T>(arr: T[], key: (x: T) => number): T[] {
  const a = [...arr]
  for (let i = 2; i < a.length; i++) {
    if (key(a[i]) === key(a[i - 1]) && key(a[i]) === key(a[i - 2])) {
      const j = a.findIndex((x, idx) => idx > i && key(x) !== key(a[i]))
      if (j > -1) {
        const t = a[i]
        a[i] = a[j]
        a[j] = t
      }
    }
  }
  return a
}

/**
 * 温故题：从过去两天里随机抽，保证音不同、顺序不固定。
 * 第 1 天没有历史，就从当天随机抽 3 个 —— 不能直接 slice(0,3)，
 * 那样永远是 ā á ǎ 顺序出现，孩子会背位置而不是听声音。
 */
export function buildWarmup(day: DayConfig): Item[] {
  const prev = DAYS.filter((d) => d.day < day.day).slice(-2)
  const pool: Item[] = []
  for (const d of prev) {
    for (const item of d.items) {
      if (item.kind === "syllable" || item.kind === "final") pool.push(item)
    }
  }

  if (pool.length === 0) {
    const today = day.items.filter((i) => i.tone > 0)
    return avoidRuns(shuffle(today).slice(0, 3), (x) => x.tone)
  }

  const picked: Item[] = []
  const usedBase = new Set<string>()
  for (const item of shuffle(pool)) {
    if (picked.length >= 6) break
    if (usedBase.has(item.base)) continue
    usedBase.add(item.base)
    picked.push(item)
  }
  return avoidRuns(shuffle(picked), (x) => x.tone)
}

/** 当日全部可点读的条目（含声母与音节） */
export function dayItems(day: DayConfig): Item[] {
  return day.items
}
