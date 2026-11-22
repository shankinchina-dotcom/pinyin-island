import { Avatar } from "@/components/Avatar"
import { IslandBg } from "@/components/IslandBg"
import { toast } from "@/components/Toast"
import { DAYS, getDay } from "@/content"
import {
  activeProfile,
  nextDayOf,
  streakOf,
  todayStats,
  todayKey,
  useProgress,
} from "@/data/store"

const SEA_LABEL: Record<string, string> = {
  basic: "基础海",
  final: "复韵母海",
  nasal: "鼻音海",
  review: "复习海",
}

export function MapPage({
  onStart,
  onParent,
  onSwitch,
}: {
  onStart: (day: number) => void
  onParent: () => void
  onSwitch: () => void
}) {
  const profile = activeProfile()
  const progress = useProgress(profile?.id ?? null)
  const dayNo = profile ? nextDayOf(profile.id) : 1
  const day = getDay(dayNo)
  const stats = profile ? todayStats(profile.id) : { reads: 0, minutes: 0, stars: 0, attempts: 0, correct: 0 }
  const streak = profile ? streakOf(profile.id) : 0
  const done = progress.doneDays
  const todayReads = Object.values(progress.readsByDate[todayKey()] ?? {}).reduce((a, b) => a + b, 0)

  return (
    <div className="map-wrap">
      <IslandBg current={dayNo} done={done} />

      <div className="map-content">
        <header className="topbar">
          <button className="avatar-btn" onClick={onSwitch} title="退出当前钥匙">
            <Avatar avatar={profile?.avatar ?? "nuo"} size={36} />
            {profile?.name ?? "小朋友"}
          </button>
          <span className="tiny">钥匙已记住</span>
          <div className="spacer" />
          <button className="btn ghost small" onClick={onParent}>
            家长
          </button>
        </header>

        <div className="shell stack lg">
          <div className="card task-card fade-up">
            <div className="row between wrap">
              <span className="tiny">
                第 {dayNo} 关 · {day ? SEA_LABEL[day.sea] : "在建"}
              </span>
              <span className="tiny">今天 · {todayReads} / 5 遍</span>
            </div>

            <h1 className="h1">{day ? day.theme : "这座岛还在建"}</h1>
            <p className="muted">{day ? day.intro : "前面的岛先玩熟，第四座马上就来。"}</p>

            <div className="chip-row" style={{ justifyContent: "flex-start" }}>
              {(day?.goals ?? ["每天 12 分钟"]).map((g) => (
                <span className="sea-chip" key={g}>
                  {g}
                </span>
              ))}
            </div>

            <div className="row between wrap" style={{ gap: 12 }}>
              <div className="counter">
                <span>今天已读</span>
                <b>{todayReads}</b>
                <span>/ 5 遍</span>
              </div>
              <button
                className="btn primary"
                onClick={() => (day ? onStart(dayNo) : toast("这座岛还在建，先玩前三座"))}
              >
                今天读一读
              </button>
            </div>
          </div>

          <div className="sea-row">
            {Object.entries(SEA_LABEL).map(([key, label]) => {
              const isOn = day?.sea === key
              return (
                <span className={`sea-chip ${isOn ? "on" : ""}`} key={key}>
                  {label}
                  {key === "basic" && done.filter((d) => d <= 10).length > 0
                    ? ` · ${done.filter((d) => d <= 10).length}/10`
                    : ""}
                </span>
              )
            })}
          </div>

          <div>
            <div className="row between" style={{ padding: "0 4px" }}>
              <span className="tiny">23 座岛</span>
              <span className="tiny">点亮 {done.length} 座</span>
            </div>
            <div className="day-strip">
              {Array.from({ length: 23 }, (_, i) => i + 1).map((d) => {
                const isDone = done.includes(d)
                const isCurrent = d === dayNo && !!day
                const built = DAYS.some((x) => x.day === d)
                return (
                  <button
                    key={d}
                    className={`day-chip ${isDone ? "done" : ""} ${isCurrent ? "current" : ""} ${
                      built ? "" : "locked"
                    }`}
                    onClick={() => {
                      if (built) onStart(d)
                      else toast("这座岛还在建，先玩前三座")
                    }}
                  >
                    <span className="num">{d}</span>
                    <span className="lab">{isDone ? "点亮" : built ? "待读" : "在建"}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid2">
            <div className="stat">
              <span className="tiny">连续</span>
              <b>{streak} 天</b>
            </div>
            <div className="stat">
              <span className="tiny">今天的星星</span>
              <b>{stats.stars} / 3</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
