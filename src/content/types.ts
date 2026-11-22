/** 内容层类型定义：所有拼音数据都必须符合这里的形状 */

export type SeaKey = "basic" | "final" | "nasal" | "review"
export type ItemKind = "initial" | "final" | "whole" | "syllable" | "word"
export type GameKind = "tone-slide" | "fog" | "fish"
export type BuildKind = "tone-order" | "combine"

export interface Phoneme {
  /** 同时是音频 key */
  id: string
  pinyin: string
  base: string
  kind: "initial" | "final" | "whole"
  /** 喂给 TTS 的同音汉字 */
  char: string
  /** 发音提示，给孩子和家长看 */
  tip?: string
  /** 是否为近似音（如 eng / ong 没有独立常用字），待人工录音替换 */
  approx?: boolean
}

export interface Item {
  /** 同时是音频 key，如 d01_a_1 */
  id: string
  kind: ItemKind
  /** 显示用，带调号：ā / bà ba */
  pinyin: string
  /** 不带调：a / ba */
  base: string
  /** 0 表示轻声或整词 */
  tone: number
  /** 例字或词 */
  char: string
  /** 例字的完整拼法，避免「吴=ú」这类谐音误解 */
  examplePinyin?: string
  /** 口型 / 发音提示 */
  tip?: string
}

export interface BuildTask {
  initial: string
  final: string
  /** 合成结果，如 bā */
  result: string
  /** 结果对应的 item id（用于取音频） */
  itemId: string
  char: string
}

export interface NewGroup {
  label: string
  hint?: string
  ids: string[]
}

export interface DayConfig {
  day: number
  theme: string
  sea: SeaKey
  intro: string
  goals: string[]
  items: Item[]
  newGroups: NewGroup[]
  buildKind: BuildKind
  buildTasks: BuildTask[]
  game: GameKind
  readIds: string[]
  closings: string[]
}

export interface DaysFile {
  days: DayConfig[]
}
