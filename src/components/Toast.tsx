import { useEffect, useState } from "react"

let timer: ReturnType<typeof setTimeout> | undefined
let listeners: ((msg: string | null) => void)[] = []

export function toast(msg: string, ms = 2000): void {
  listeners.forEach((fn) => fn(msg))
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => listeners.forEach((fn) => fn(null)), ms)
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const fn = (m: string | null) => setMsg(m)
    listeners.push(fn)
    return () => {
      listeners = listeners.filter((l) => l !== fn)
    }
  }, [])

  if (!msg) return null
  return (
    <div className="toast" role="status">
      {msg}
    </div>
  )
}
