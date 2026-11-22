export type Tab = "map" | "practice" | "growth"

const ITEMS: { key: Tab; label: string; ico: string }[] = [
  { key: "map", label: "拼音岛", ico: "◍" },
  { key: "practice", label: "自由练习", ico: "✎" },
  { key: "growth", label: "我的成长", ico: "❀" },
]

export function Nav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        {ITEMS.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${tab === item.key ? "on" : ""}`}
            onClick={() => onChange(item.key)}
            aria-current={tab === item.key ? "page" : undefined}
          >
            <span className="ico" aria-hidden>
              {item.ico}
            </span>
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
