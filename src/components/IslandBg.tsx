import { useEffect, useRef, useState } from "react"
import { createIslandScene, type IslandHandle, type IslandState } from "@/three/island"

const STATE_BY_DAY = (day: number, current: number, done: number[]): IslandState => {
  if (done.includes(day)) return "done"
  if (day === current) return "current"
  return "locked"
}

/** 地图背景的漂浮群岛；同样每次挂载新建 canvas，避免 StrictMode 复用失效上下文 */
export function IslandBg({ current, done }: { current: number; done: number[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<IslandHandle | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const canvas = document.createElement("canvas")
    canvas.setAttribute("aria-hidden", "true")
    host.appendChild(canvas)

    let handle: IslandHandle | null = null
    try {
      handle = createIslandScene(canvas)
      handleRef.current = handle
    } catch {
      setFailed(true)
    }

    return () => {
      handle?.dispose()
      handleRef.current = null
      canvas.remove()
    }
  }, [])

  useEffect(() => {
    const islands = Array.from({ length: 23 }, (_, i) => ({
      day: i + 1,
      state: STATE_BY_DAY(i + 1, current, done),
    }))
    handleRef.current?.setState(islands)
  }, [current, done])

  if (failed) {
    return (
      <div
        className="island-bg"
        style={{ background: "linear-gradient(180deg,#fff8f0,#e9f2ff 60%,#f3ebff)" }}
        aria-hidden
      />
    )
  }

  return <div className="island-bg" ref={hostRef} aria-hidden />
}
