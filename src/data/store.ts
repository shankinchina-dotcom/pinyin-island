import { useSyncExternalStore } from "react"

export interface Profile {
  id: string
  name: string
  avatar: string
  createdAt: string
}

export interface Attempt {
  itemId: string
  day: number
  correct: boolean
  ts: number
}

export interface Cursor {
  step: number
  index: number
}

export interface ChildProgress {
  cursor: Record<number, Cursor>
  doneDays: number[]
  attempts: Attempt[]
  /** 日期 -> 当天获得的星星（上限 3） */
  stars: Record<string, number>
  badges: string[]
  /** itemId -> 累计朗读遍数 */
  reads: Record<string, number>
  /** 日期 -> itemId -> 遍数 */
  readsByDate: Record<string, Record<string, number>>
  secondsByDate: Record<string, number>
  /** 日期 -> 家长是否确认过 */
  confirmed: Record<string, boolean>
  lastSeen: string
}

export interface AppState {
  version: number
  profiles: Profile[]
  activeId: string | null
  parentPin: string
  progress: Record<string, ChildProgress>
}

const KEY = "pinyin-island.v1"

const AVATARS = ["nuo", "buding", "jiujiu", "pupu", "yun", "miao", "xing", "hai"]

export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function emptyProgress(): ChildProgress {
  return {
    cursor: {},
    doneDays: [],
    attempts: [],
    stars: {},
    badges: [],
    reads: {},
    readsByDate: {},
    secondsByDate: {},
    confirmed: {},
    lastSeen: todayKey(),
  }
}

function initialState(): AppState {
  return {
    version: 1,
    profiles: [
      { id: "kid_a", name: "小禾", avatar: AVATARS[0], createdAt: todayKey() },
      { id: "kid_b", name: "小满", avatar: AVATARS[1], createdAt: todayKey() },
    ],
    activeId: null,
    parentPin: "1234",
    progress: {},
  }
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState()
    const parsed = JSON.parse(raw) as AppState
    if (!parsed.profiles?.length) return initialState()
    return parsed
  } catch {
    return initialState()
  }
}

let state: AppState = load()
const listeners = new Set<() => void>()

function commit(next: AppState): void {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 配额满了也不该崩 */
  }
  listeners.forEach((fn) => fn())
}

export function getState(): AppState {
  return state
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState, getState)
}

export function useProgress(childId: string | null): ChildProgress {
  const s = useAppState()
  if (!childId) return emptyProgress()
  return s.progress[childId] ?? emptyProgress()
}

function ensureChild(s: AppState, childId: string): ChildProgress {
  return s.progress[childId] ?? emptyProgress()
}

function withProgress(childId: string, fn: (p: ChildProgress) => ChildProgress): void {
  const next = { ...state, progress: { ...state.progress } }
  next.progress[childId] = fn(ensureChild(state, childId))
  commit(next)
}

export function listProfiles(): Profile[] {
  return state.profiles
}

export function setActive(id: string | null): void {
  commit({ ...state, activeId: id })
}

export function activeProfile(): Profile | null {
  return state.profiles.find((p) => p.id === state.activeId) ?? null
}

export function createProfile(name: string, avatar: string): Profile {
  const profile: Profile = { id: uid("kid"), name, avatar, createdAt: todayKey() }
  commit({ ...state, profiles: [...state.profiles, profile], progress: { ...state.progress, [profile.id]: emptyProgress() } })
  return profile
}

/** 按固定 id 建档案（钥匙登录用）；已存在则原样返回，不动进度 */
export function ensureProfile(id: string, name: string, avatar: string): Profile {
  const found = state.profiles.find((p) => p.id === id)
  if (found) {
    if (found.name !== name || found.avatar !== avatar) {
      commit({
        ...state,
        profiles: state.profiles.map((p) => (p.id === id ? { ...p, name, avatar } : p)),
      })
      return state.profiles.find((p) => p.id === id)!
    }
    return found
  }
  const profile: Profile = { id, name, avatar, createdAt: todayKey() }
  commit({
    ...state,
    profiles: [...state.profiles, profile],
    progress: state.progress[id] ? state.progress : { ...state.progress, [id]: emptyProgress() },
  })
  return profile
}

export function renameProfile(id: string, name: string, avatar?: string): void {
  commit({
    ...state,
    profiles: state.profiles.map((p) => (p.id === id ? { ...p, name, avatar: avatar ?? p.avatar } : p)),
  })
}

export function deleteProfile(id: string): void {
  const progress = { ...state.progress }
  delete progress[id]
  commit({
    ...state,
    profiles: state.profiles.filter((p) => p.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
    progress,
  })
}

export function setParentPin(pin: string): void {
  commit({ ...state, parentPin: pin })
}

export function checkPin(pin: string): boolean {
  return state.parentPin === pin
}

export function setCursor(childId: string, day: number, cursor: Cursor | null): void {
  withProgress(childId, (p) => {
    const next = { ...p, cursor: { ...p.cursor } }
    if (cursor) next.cursor[day] = cursor
    else delete next.cursor[day]
    return { ...next, lastSeen: todayKey() }
  })
}

export function recordAttempt(childId: string, itemId: string, day: number, correct: boolean): void {
  withProgress(childId, (p) => ({
    ...p,
    attempts: [...p.attempts.slice(-4000), { itemId, day, correct, ts: Date.now() }],
    lastSeen: todayKey(),
  }))
}

export function addRead(childId: string, itemId: string): void {
  const day = todayKey()
  withProgress(childId, (p) => {
    const reads = { ...p.reads, [itemId]: (p.reads[itemId] ?? 0) + 1 }
    const today = { ...(p.readsByDate[day] ?? {}) }
    today[itemId] = (today[itemId] ?? 0) + 1
    return { ...p, reads, readsByDate: { ...p.readsByDate, [day]: today } }
  })
}

export function resetProgress(childId: string): void {
  withProgress(childId, () => emptyProgress())
}

export function confirmDay(childId: string, date = todayKey()): void {
  withProgress(childId, (p) => ({ ...p, confirmed: { ...p.confirmed, [date]: true } }))
}

export function addSeconds(childId: string, seconds: number): void {
  const day = todayKey()
  withProgress(childId, (p) => ({
    ...p,
    secondsByDate: { ...p.secondsByDate, [day]: (p.secondsByDate[day] ?? 0) + seconds },
  }))
}

/** 完成一天：记进度、结星星（上限 3）、发徽章 */
export function finishDay(childId: string, day: number, earned: number): { stars: number; newBadges: string[] } {
  const date = todayKey()
  let granted: string[] = []
  withProgress(childId, (p) => {
    const doneDays = p.doneDays.includes(day) ? p.doneDays : [...p.doneDays, day]
    const todayStars = Math.min(3, p.stars[date] ?? 0)
    const stars = { ...p.stars, [date]: Math.max(todayStars, Math.min(3, earned)) }
    const badges = new Set(p.badges)

    const accuracy = dayAccuracy(p, day)
    if (day === 1) badges.add("day1")
    if (day === 2 && accuracy >= 0.8) badges.add("lip")
    if (day === 3) badges.add("nl")
    if (doneDays.length >= 3) badges.add("three")
    if (Object.values(p.readsByDate[date] ?? {}).reduce((a, b) => a + b, 0) >= 5) badges.add("read5")
    if (accuracy === 1 && (p.attempts.filter((a) => a.day === day).length ?? 0) >= 6) badges.add("perfect")

    granted = [...badges].filter((b) => !p.badges.includes(b))
    return { ...p, doneDays, stars, badges: [...badges], lastSeen: date }
  })
  return { stars: earned, newBadges: granted }
}

function dayAccuracy(p: ChildProgress, day: number): number {
  const list = p.attempts.filter((a) => a.day === day)
  if (!list.length) return 0
  return list.filter((a) => a.correct).length / list.length
}

export function todayStats(childId: string): { attempts: number; correct: number; reads: number; minutes: number; stars: number } {
  const p = state.progress[childId] ?? emptyProgress()
  const today = todayKey()
  const dayAttempts = p.attempts.filter((a) => new Date(a.ts).toDateString() === new Date().toDateString())
  const reads = Object.values(p.readsByDate[today] ?? {}).reduce((a, b) => a + b, 0)
  return {
    attempts: dayAttempts.length,
    correct: dayAttempts.filter((a) => a.correct).length,
    reads,
    minutes: Math.round((p.secondsByDate[today] ?? 0) / 60),
    stars: p.stars[today] ?? 0,
  }
}

export function streakOf(childId: string): number {
  const p = state.progress[childId] ?? emptyProgress()
  let n = 0
  for (let i = 0; i < 60; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    if ((p.stars[todayKey(d)] ?? 0) > 0) n++
    else if (i > 0) break
  }
  return n
}

export function nextDayOf(childId: string): number {
  const p = state.progress[childId] ?? emptyProgress()
  for (let d = 1; d <= 23; d++) {
    if (!p.doneDays.includes(d)) return d
  }
  return 23
}

export { AVATARS }
