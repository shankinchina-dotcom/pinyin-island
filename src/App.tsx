import { useEffect, useState } from "react"
import { Nav, type Tab } from "@/components/Nav"
import { ToastHost, toast } from "@/components/Toast"
import { getDay } from "@/content"
import { logout, readSession, type Session } from "@/data/access"
import { ensureProfile, useAppState } from "@/data/store"
import { DayFlow } from "@/pages/DayFlow"
import { Gate } from "@/pages/Gate"
import { GrowthPage } from "@/pages/GrowthPage"
import { MapPage } from "@/pages/MapPage"
import { ParentPage } from "@/pages/ParentPage"
import { PracticePage } from "@/pages/PracticePage"

type View = "kid" | "day" | "parent"

/** 仅开发期可用的直达入口：?view=map|day|parent|practice|growth&day=2&as=kid_a */
const DEMO = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null

export default function App() {
  const demoView = DEMO?.get("view")
  const [view, setView] = useState<View>(
    demoView === "day" ? "day" : demoView === "parent" ? "parent" : "kid",
  )
  const [tab, setTab] = useState<Tab>(
    demoView === "practice" ? "practice" : demoView === "growth" ? "growth" : "map",
  )
  const [dayNo, setDayNo] = useState<number | null>(
    demoView === "day" ? Number(DEMO?.get("day") ?? 1) : null,
  )
  const state = useAppState()
  const [session, setSession] = useState<Session | null>(() => readSession())
  const profile = session ? state.profiles.find((p) => p.id === session.childId) ?? null : null

  useEffect(() => {
    // 钥匙对应的档案若被删掉，重新建一个空档案，不让孩子卡在门口
    if (session && !state.profiles.some((p) => p.id === session.childId)) {
      ensureProfile(session.childId, "小岛居民", "nuo")
    }
  }, [session, state.profiles])

  if (view === "parent") {
    return (
      <>
        <ParentPage onBack={() => setView("kid")} />
        <ToastHost />
      </>
    )
  }

  if (!profile) {
    return (
      <>
        <Gate
          onEnter={(s) => {
            setSession(s)
            setTab("map")
            setView("kid")
          }}
          onParent={() => setView("parent")}
        />
        <ToastHost />
      </>
    )
  }

  if (view === "day") {
    const day = dayNo ? getDay(dayNo) : undefined
    if (day) {
      return (
        <>
          <DayFlow
            day={day}
            childId={profile.id}
            onExit={() => {
              setView("kid")
              setDayNo(null)
              setTab("map")
            }}
          />
          <ToastHost />
        </>
      )
    }
  }

  return (
    <>
      <div className="app">
        {tab === "map" && (
          <MapPage
            onStart={(d) => {
              const target = getDay(d)
              if (!target) {
                toast("这座岛还在建，先玩前三座")
                return
              }
              setDayNo(d)
              setView("day")
            }}
            onParent={() => setView("parent")}
            onSwitch={() => {
              logout()
              setSession(null)
              setTab("map")
            }}
          />
        )}
        {tab === "practice" && <PracticePage />}
        {tab === "growth" && <GrowthPage />}
      </div>
      <Nav tab={tab} onChange={setTab} />
      <ToastHost />
    </>
  )
}
