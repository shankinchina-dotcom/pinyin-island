import { useRef, useState } from "react"
import { loginWithCode, normalizeCode, SESSION_DAYS, type Session } from "@/data/access"

export function Gate({
  onEnter,
  onParent,
}: {
  onEnter: (session: Session) => void
  onParent: () => void
}) {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const submit = async (value = code) => {
    if (busy) return
    setBusy(true)
    const res = await loginWithCode(value)
    setBusy(false)
    if (res.ok) {
      onEnter(res.session)
      return
    }
    setError(res.reason)
    setShake(true)
    window.setTimeout(() => setShake(false), 500)
    setCode("")
    inputRef.current?.focus()
  }

  return (
    <div className="gate">
      <div className="gate-inner" style={{ maxWidth: 430 }}>
        <div className="stack" style={{ alignItems: "center", gap: 12 }}>
          <span className="tiny" style={{ letterSpacing: 4 }}>
            拼 音 岛
          </span>
          <h1 className="h1">输入你的小岛钥匙</h1>
          <p className="muted">
            六位数字，爸爸妈妈会给你。输一次，这台设备 {SESSION_DAYS} 天内不用再输。
          </p>
        </div>

        <div className="stack" style={{ width: "100%", alignItems: "center", gap: 14 }}>
          <input
            ref={inputRef}
            className={`pin-input ${shake ? "is-wrong" : ""}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            autoFocus
            placeholder=""
            aria-label="小岛钥匙"
            onChange={(e) => {
              const v = normalizeCode(e.target.value).replace(/\D/g, "").slice(0, 6)
              setCode(v)
              setError("")
              if (v.length === 6) window.setTimeout(() => void submit(v), 120)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.length === 6) void submit()
            }}
          />

          {error ? (
            <p className="tiny" style={{ color: "#c2606b" }}>
              {error}
            </p>
          ) : (
            <span className="tiny">钥匙不对可以找家长再要一次</span>
          )}

          <button
            className="btn primary"
            style={{ minWidth: 220 }}
            onClick={() => void submit()}
            disabled={code.length !== 6 || busy}
          >
            进岛
          </button>
        </div>

        <button className="btn ghost small" onClick={onParent}>
          家长入口
        </button>
      </div>
    </div>
  )
}
