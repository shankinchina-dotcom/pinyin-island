import { useEffect, useRef, useState } from "react"
import { createNuonuo, type Action, type Mood, type Mouth, type NuonuoHandle } from "@/three/nuonuo"

export interface NuonuoProps {
  mouth?: Mouth
  mood?: Mood
  tone?: 1 | 2 | 3 | 4
  action?: Action
  actionKey?: number
  height?: number
  className?: string
}

/**
 * 3D 角色容器。
 * canvas 交给 React 渲染：JS 动态插入的 canvas 可能拿不到已应用的 CSS 尺寸，
 * 画布会停在 1×1，表现为「角色不见了」。
 */
export function Nuonuo({
  mouth = "smile",
  mood = "idle",
  tone = 1,
  action,
  actionKey = 0,
  height = 340,
  className,
}: NuonuoProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const handleRef = useRef<NuonuoHandle | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let handle: NuonuoHandle | null = null
    try {
      handle = createNuonuo(canvas)
      handleRef.current = handle
      handle.setMouth(mouth)
      handle.setMood(mood)
      handle.setTone(tone)
      // 首帧时父容器可能还没完成布局，补一次尺寸同步
      requestAnimationFrame(() => handle?.resize())
    } catch {
      setFailed(true)
    }
    return () => {
      handle?.dispose()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    handleRef.current?.setMouth(mouth)
  }, [mouth])

  useEffect(() => {
    handleRef.current?.setMood(mood)
  }, [mood])

  useEffect(() => {
    handleRef.current?.setTone(tone)
  }, [tone])

  useEffect(() => {
    if (!action || actionKey === 0) return
    handleRef.current?.play(action)
  }, [action, actionKey])

  return (
    <div className={`stage3d ${className ?? ""}`} style={{ height }}>
      <canvas ref={canvasRef} aria-hidden />
      {failed && (
        <div className="center" style={{ position: "absolute", inset: 0 }}>
          <div style={{ fontSize: 64 }}>☁</div>
          <p className="tiny">这台设备用简洁模式陪你</p>
        </div>
      )}
    </div>
  )
}
