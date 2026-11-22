export interface BadgeDef {
  key: string
  name: string
  ico: string
  desc: string
}

export const BADGES: BadgeDef[] = [
  { key: "day1", name: "单韵母小主人", ico: "韵", desc: "完成第 1 天" },
  { key: "lip", name: "双唇音小队", ico: "唇", desc: "第 2 天首答正确率 80% 以上" },
  { key: "nl", name: "n l 分得开", ico: "舌", desc: "完成第 3 天" },
  { key: "three", name: "三岛小船长", ico: "船", desc: "点亮前三座岛" },
  { key: "read5", name: "读满五遍", ico: "读", desc: "一天里读满 5 遍" },
  { key: "perfect", name: "一次就对", ico: "全", desc: "当天首答全对" },
]

export function badgeByKey(key: string): BadgeDef | undefined {
  return BADGES.find((b) => b.key === key)
}
