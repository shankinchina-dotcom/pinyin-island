/**
 * 音频播放：优先用预生成的 mp3（public/audio/v1），
 * 音频缺失时回退到浏览器语音合成，保证开发期也能点响。
 */

type Manifest = {
  version: string
  files: { key: string; path: string; sha256?: string; text?: string }[]
}

const BASE = `${import.meta.env.BASE_URL}audio/v1/`

let ctx: AudioContext | null = null
let manifest: Map<string, string> | null = null
let manifestTried = false
const buffers = new Map<string, AudioBuffer>()
const inflight = new Map<string, Promise<AudioBuffer | null>>()
let current: AudioBufferSourceNode | null = null
let currentEl: HTMLAudioElement | null = null

export function audioContext(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor()
  }
  return ctx
}

/** 必须由用户手势调用一次，iOS 才会出声 */
export async function unlockAudio(): Promise<void> {
  const c = audioContext()
  if (c.state === "suspended") await c.resume()
  c.onstatechange = () => {
    if (c.state === "suspended") void c.resume()
  }
}

async function loadManifest(): Promise<Map<string, string>> {
  if (manifest) return manifest
  const map = new Map<string, string>()
  if (!manifestTried) {
    manifestTried = true
    try {
      const res = await fetch(`${BASE}manifest.json`, { cache: "no-cache" })
      if (res.ok) {
        const data = (await res.json()) as Manifest
        for (const f of data.files) {
          const v = f.sha256 ? `?h=${f.sha256.slice(0, 8)}` : ""
          map.set(f.key, `${f.path}${v}`)
        }
      }
    } catch {
      /* 没有音频清单就走回退 */
    }
  }
  manifest = map
  return map
}

export async function hasRealAudio(): Promise<boolean> {
  return (await loadManifest()).size > 0
}

async function loadBuffer(key: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(key)
  if (cached) return cached
  const pending = inflight.get(key)
  if (pending) return pending

  const task = (async () => {
    const map = await loadManifest()
    const path = map.get(key)
    if (!path) return null
    try {
      const res = await fetch(`${BASE}${path}`)
      if (!res.ok) return null
      const bytes = await res.arrayBuffer()
      const buf = await audioContext().decodeAudioData(bytes)
      buffers.set(key, buf)
      return buf
    } catch {
      return null
    }
  })()

  inflight.set(key, task)
  const result = await task
  inflight.delete(key)
  return result
}

/** 预加载一批音频，进入关卡时调用 */
export async function preload(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => loadBuffer(k)))
}

function speak(text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    if (!synth || !text) {
      resolve()
      return
    }
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = "zh-CN"
    u.rate = rate
    u.onend = () => resolve()
    u.onerror = () => resolve()
    synth.speak(u)
  })
}

export interface PlayOptions {
  /** 1 = 原速，0.8 = 慢速 */
  rate?: number
  /** 音频缺失时的回退文本，默认由调用方给例字 */
  fallbackText?: string
}

export function stop(): void {
  if (current) {
    try {
      current.stop()
    } catch {
      /* 已经结束 */
    }
    current = null
  }
  if (currentEl) {
    try {
      currentEl.pause()
      currentEl.currentTime = 0
    } catch {
      /* 已经结束 */
    }
    currentEl = null
  }
  window.speechSynthesis?.cancel()
}

/**
 * 慢速播放：AudioBufferSourceNode.playbackRate 会连带降调，
 * 会把音调一起压低，听起来像另一个音，所以改用 audio 元素的 preservesPitch。
 */
function playSlow(url: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    const el = new Audio(url)
    el.playbackRate = rate
    el.preservesPitch = true
    ;(el as HTMLAudioElement & { mozPreservesPitch?: boolean }).mozPreservesPitch = true
    const finish = () => {
      if (currentEl === el) currentEl = null
      resolve()
    }
    el.onended = finish
    el.onerror = finish
    currentEl = el
    void el.play().catch(finish)
  })
}

/** 播放一个 key；返回的 Promise 在播完后 resolve */
export async function play(key: string, opts: PlayOptions = {}): Promise<void> {
  const rate = opts.rate ?? 1
  stop()
  const buf = await loadBuffer(key)
  if (!buf) {
    await speak(opts.fallbackText ?? "", 0.85 * rate)
    return
  }
  if (rate !== 1) {
    const map = await loadManifest()
    const rel = map.get(key)
    if (rel) return playSlow(`${BASE}${rel}`, rate)
  }
  const c = audioContext()
  if (c.state === "suspended") await c.resume()
  return new Promise<void>((resolve) => {
    const src = c.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    src.connect(c.destination)
    src.onended = () => {
      if (current === src) current = null
      resolve()
    }
    current = src
    src.start()
  })
}

/**
 * 答错时的提示音：两声柔和的下降音，不刺耳、不做成惩罚性的失败音效。
 * 完全由 Web Audio 生成，无需资源文件。
 */
export function playOops(): void {
  try {
    const c = audioContext()
    if (c.state === "suspended") void c.resume()
    const now = c.currentTime
    for (const [i, freq] of [523.25, 392].entries()) {
      const osc = c.createOscillator()
      const gain = c.createGain()
      const t = now + i * 0.11
      osc.type = "sine"
      osc.frequency.setValueAtTime(freq, t)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.linearRampToValueAtTime(0.06, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17)
      osc.connect(gain).connect(c.destination)
      osc.start(t)
      osc.stop(t + 0.2)
    }
  } catch {
    /* 浏览器不支持 Web Audio 时静默跳过 */
  }
}

/** 当前有没有正在播 */
export function playing(): boolean {
  return current !== null
}
