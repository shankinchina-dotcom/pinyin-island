import { useEffect, useMemo, useState } from "react"
import { loadCodes, readSession, sessionDaysLeft, type AccessEntry } from "@/data/access"
import { DAYS } from "@/content"
import { toast } from "@/components/Toast"
import {
  activeProfile,
  checkPin,
  confirmDay,
  deleteProfile,
  resetProgress,
  setParentPin,
  todayStats,
  useProgress,
} from "@/data/store"

type Tab = "today" | "report" | "settings"

export function ParentPage({ onBack }: { onBack: () => void }) {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState("")
  const [tab, setTab] = useState<Tab>("today")
  const [codes, setCodes] = useState<AccessEntry[]>([])
  useEffect(() => {
    void loadCodes().then(setCodes)
  }, [])
  const [newPin, setNewPin] = useState("")
  const profile = activeProfile()
  const p = useProgress(profile?.id ?? null)
  const stats = profile ? todayStats(profile.id) : { attempts: 0, correct: 0, reads: 0, minutes: 0, stars: 0 }

  const lastDone = p.doneDays.length ? Math.max(...p.doneDays) : 1
  const accuracy = stats.attempts > 0 ? Math.round((stats.correct / stats.attempts) * 100) : null

  const advice = useMemo(() => {
    if (stats.reads === 0 && stats.attempts === 0) return "今天还没开始。读一遍也算数，不必等到状态好。"
    if (stats.reads < 5) return `今天读了 ${stats.reads} 遍，老师要求 5 遍，还差 ${5 - stats.reads} 遍。`
    if (accuracy !== null && accuracy < 70) return "今天点错了几题，明天先玩 3 分钟声调滑梯，再学新音。"
    if (accuracy !== null && accuracy >= 90) return "今天很稳，明天可以把复习题减半，多学一个新音。"
    return "今天节奏正常，保持 12 分钟就够了。"
  }, [stats.reads, stats.attempts, accuracy])

  const rows = useMemo(() => {
    return Array.from({ length: 23 }, (_, i) => {
      const d = i + 1
      const conf = DAYS.find((x) => x.day === d)
      const att = p.attempts.filter((a) => a.day === d)
      const acc = att.length ? Math.round((att.filter((a) => a.correct).length / att.length) * 100) : null
      const reads = conf ? conf.items.reduce((sum, it) => sum + (p.reads[it.id] ?? 0), 0) : 0
      return {
        d,
        theme: conf?.theme ?? "—",
        reads,
        acc,
        confirmed: !!p.confirmed[String(d)],
        built: !!conf,
      }
    })
  }, [p])

  if (!unlocked) {
    return (
      <div className="gate">
        <div className="gate-inner" style={{ maxWidth: 420 }}>
          <h1 className="h1">家长入口</h1>
          <p className="muted">输入 4 位密码。初始密码是 1234，进去后可以改。</p>
          <input
            className="pin-input"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            autoFocus
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pin.length === 4) {
                if (checkPin(pin)) setUnlocked(true)
                else toast("密码不对，再试一次")
              }
            }}
          />
          <button
            className="btn primary"
            onClick={() => {
              if (checkPin(pin)) setUnlocked(true)
              else toast("密码不对，再试一次")
            }}
          >
            进去
          </button>
          <button className="btn ghost small" onClick={onBack}>
            回孩子端
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="shell stack lg" style={{ paddingTop: 12 }}>
      <div className="row between">
        <div>
          <h1 className="h1">家长端</h1>
          <p className="muted">{profile ? `${profile.name} · 最近一次 ${p.lastSeen}` : "还没选孩子档案"}</p>
        </div>
        <button className="btn ghost small" onClick={onBack}>
          回孩子端
        </button>
      </div>

      <div className="tabs">
        {(
          [
            ["today", "今天"],
            ["report", "学习报告"],
            ["settings", "设置"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? "on" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "today" && (
        <div className="stack lg">
          <div className="grid2">
            <div className="stat">
              <span className="tiny">今天练了</span>
              <b>{stats.minutes} 分钟</b>
            </div>
            <div className="stat">
              <span className="tiny">朗读遍数</span>
              <b>{stats.reads} 遍</b>
            </div>
            <div className="stat">
              <span className="tiny">首答正确率</span>
              <b>{accuracy === null ? "—" : `${accuracy}%`}</b>
            </div>
            <div className="stat">
              <span className="tiny">星星</span>
              <b>{stats.stars} / 3</b>
            </div>
          </div>

          <div className="card soft stack">
            <h3 className="h3">一句话建议</h3>
            <p className="muted">{advice}</p>
          </div>

          <div className="card stack">
            <h3 className="h3">今天的确认</h3>
            <p className="muted">
              孩子读完 5 遍后点一下，就相当于在纸质练习册上签字。站内遍数和纸上遍数分开记，不混在一起。
            </p>
            <button
              className="btn primary"
              onClick={() => {
                if (!profile) return
                confirmDay(profile.id, String(lastDone))
                toast(`第 ${lastDone} 天已确认`)
              }}
            >
              确认第 {lastDone} 天读完了
            </button>
          </div>
        </div>
      )}

      {tab === "report" && (
        <div className="card stack">
          <div className="row between wrap">
            <h3 className="h3">23 天对照表</h3>
            <span className="tiny">可以直接截图发给老师</span>
          </div>
          <div className="table-wrap">
            <table className="report">
              <thead>
                <tr>
                  <th>天</th>
                  <th>主题</th>
                  <th>站内遍数</th>
                  <th>首答正确率</th>
                  <th>家长确认</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.d} className={r.built && r.reads < 5 && r.reads > 0 ? "todo" : ""}>
                    <td>{r.d}</td>
                    <td>{r.theme}</td>
                    <td>{r.built ? r.reads : "—"}</td>
                    <td>{r.acc === null ? "—" : `${r.acc}%`}</td>
                    <td>{r.confirmed ? "已确认" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny">前 3 天有内容，第 4 天起是「在建」。这张表的口径：正确率 = 首答正确 ÷ 总题数，重试不计。</p>
        </div>
      )}

      {tab === "settings" && (
        <div className="stack lg">
          <div className="card stack">
            <div className="row between">
              <h3 className="h3">小岛钥匙</h3>
              <span className="tiny">当前这把还剩 {sessionDaysLeft(readSession())} 天</span>
            </div>
            <p className="muted">
              每个孩子一把六位数字。发给他之后，他在自己设备上输一次，三十天内免输；过期后用同一把还能进。
            </p>
            <div className="table-wrap">
              <table className="report">
                <thead>
                  <tr>
                    <th>钥匙</th>
                    <th>孩子</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: "var(--font-pinyin)", letterSpacing: 2 }}>{c.code}</td>
                      <td>{c.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny">要增删或改名，改 public/access.json（不进仓库，部署时单独上传）。id 不能动，进度跟着 id 走。</p>
          </div>
          <div className="card stack">
            <h3 className="h3">改家长密码</h3>
            <div className="row wrap">
              <input
                className="pin-input"
                style={{ maxWidth: 220, letterSpacing: 8 }}
                inputMode="numeric"
                maxLength={4}
                value={newPin}
                placeholder="新的 4 位"
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              <button
                className="btn small"
                onClick={() => {
                  if (newPin.length !== 4) {
                    toast("要 4 位数字")
                    return
                  }
                  setParentPin(newPin)
                  setNewPin("")
                  toast("密码改好了")
                }}
              >
                保存
              </button>
            </div>
          </div>

          <div className="card stack">
            <h3 className="h3">重置进度</h3>
            <p className="muted">会清空这个孩子的星星、徽章和遍数记录。内容不会被删。</p>
            <button
              className="btn ghost small"
              onClick={() => {
                if (!profile) return
                if (window.confirm(`确定清空 ${profile.name} 的全部进度吗？`)) {
                  resetProgress(profile.id)
                  toast("已经清空")
                }
              }}
            >
              清空 {profile?.name ?? "当前档案"} 的进度
            </button>
          </div>

          <div className="card stack">
            <h3 className="h3">删除档案</h3>
            <p className="muted">连同进度一起删掉，删了不能恢复。</p>
            <button
              className="btn ghost small"
              onClick={() => {
                if (!profile) return
                if (window.confirm(`确定删除「${profile.name}」这个档案吗？`)) {
                  deleteProfile(profile.id)
                  toast("档案已删除")
                  onBack()
                }
              }}
            >
              删除 {profile?.name ?? "当前档案"}
            </button>
          </div>

          <div className="card soft stack">
            <h3 className="h3">关于录音</h3>
            <p className="muted">
              跟读的录音只在浏览器内存里回放，默认不保存、不上传。只有家长主动保存才会写进账号。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
