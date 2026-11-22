import { ensureProfile, setActive } from "@/data/store"

export interface AccessEntry {
  code: string
  id: string
  name: string
  avatar: string
}

export interface Session {
  code: string
  childId: string
  expiresAt: number
}

const SESSION_KEY = "pinyin.session.v1"
/** 浏览器记住 30 天；过期后同一把钥匙还能再登 */
export const SESSION_DAYS = 30
const TTL = SESSION_DAYS * 24 * 60 * 60 * 1000
const CODES_URL = `${import.meta.env.BASE_URL}access.json`

let cache: AccessEntry[] | null = null

/**
 * 钥匙清单在运行期从 /access.json 读，不打进 JS 包，也不进仓库。
 * 这样公开代码时不会连钥匙一起公开。
 */
export async function loadCodes(force = false): Promise<AccessEntry[]> {
  if (cache && !force) return cache
  try {
    const res = await fetch(CODES_URL, { cache: "no-store" })
    if (!res.ok) return (cache = [])
    const data = (await res.json()) as { codes?: AccessEntry[] }
    cache = Array.isArray(data.codes) ? data.codes : []
    return cache
  } catch {
    return (cache = [])
  }
}

/** 去掉空格和横线，"481 203" 与 "481-203" 等价 */
export function normalizeCode(input: string): string {
  return input.replace(/[^0-9A-Za-z]/g, "").toUpperCase()
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    if (!s?.childId || typeof s.expiresAt !== "number") return null
    if (Date.now() > s.expiresAt) return null
    return s
  } catch {
    return null
  }
}

export function sessionDaysLeft(s: Session | null): number {
  if (!s) return 0
  return Math.max(0, Math.ceil((s.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

export async function loginWithCode(
  input: string,
): Promise<{ ok: true; session: Session } | { ok: false; reason: string }> {
  const codes = await loadCodes()
  if (!codes.length) {
    return { ok: false, reason: "还没配置钥匙清单，请家长先放好 access.json" }
  }
  const key = normalizeCode(input)
  const entry = codes.find((c) => normalizeCode(c.code) === key)
  if (!entry) return { ok: false, reason: "这把钥匙不对，再看看卡片上的六位数字" }

  // 档案跟着 id 走，换设备也能拿到同一个 id（进度仍存在本机）
  ensureProfile(entry.id, entry.name, entry.avatar)
  setActive(entry.id)

  const session: Session = { code: entry.code, childId: entry.id, expiresAt: Date.now() + TTL }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // 隐私模式下写不进去也不影响本次使用
  }
  return { ok: true, session }
}

export function logout(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
  setActive(null)
}
