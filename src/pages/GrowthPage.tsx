import { BADGES } from "@/data/badges"
import { activeProfile, streakOf, useProgress } from "@/data/store"

export function GrowthPage() {
  const profile = activeProfile()
  const p = useProgress(profile?.id ?? null)
  const totalReads = Object.values(p.reads).reduce((a, b) => a + b, 0)
  const done = p.doneDays.length
  const streak = profile ? streakOf(profile.id) : 0

  return (
    <div className="shell stack lg" style={{ paddingTop: 12 }}>
      <div className="stack" style={{ gap: 8 }}>
        <h1 className="h1">{profile?.name ?? "小朋友"}的成长</h1>
        <p className="muted">这里只和你自己比。</p>
      </div>

      <div className="grid2">
        <div className="stat">
          <span className="tiny">点亮的小岛</span>
          <b>{done} / 23</b>
        </div>
        <div className="stat">
          <span className="tiny">一共读了多少遍</span>
          <b>{totalReads}</b>
        </div>
        <div className="stat">
          <span className="tiny">连续天数</span>
          <b>{streak} 天</b>
        </div>
        <div className="stat">
          <span className="tiny">拿到的徽章</span>
          <b>{p.badges.length} / {BADGES.length}</b>
        </div>
      </div>

      <div className="card stack">
        <div className="row between">
          <h2 className="h2">成长树</h2>
          <span className="tiny">每完成一天，长一片叶子</span>
        </div>
        <div className="tree">
          {Array.from({ length: 23 }, (_, i) => (
            <span key={i} className={`leaf ${i < done ? "on" : ""}`} style={{ animationDelay: `${i * 30}ms` }}>
              {i < done ? "❦" : "·"}
            </span>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h2 className="h2">徽章墙</h2>
        <div className="badge-grid">
          {BADGES.map((b) => {
            const owned = p.badges.includes(b.key)
            return (
              <div key={b.key} className={`badge-card ${owned ? "owned" : ""}`}>
                <div className="badge-ico">{b.ico}</div>
                <span>{b.name}</span>
                <span style={{ fontSize: 11, opacity: 0.75 }}>{b.desc}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card soft stack">
        <h2 className="h2">录音相册</h2>
        <p className="muted">
          还没有保存过声音。跟读时点「听我的」可以回听，想留下来就告诉爸爸妈妈，他们可以在家长端保存。
        </p>
      </div>
    </div>
  )
}
