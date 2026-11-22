#!/usr/bin/env node
/**
 * 从内容数据生成音频清单请求。
 * 用法：node tools/emit-audio-requests.mjs
 * 输出：src/content/audio-requests.json
 */
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"))

const days = read("src/content/days.json").days
const phonemes = read("src/content/phonemes.json")

const out = new Map()

for (const p of phonemes) {
  out.set(p.id, {
    key: p.id,
    kind: p.kind,
    ph: p.pinyin,
    text: p.char,
    tone: null,
    approx: !!p.approx,
  })
}

for (const day of days) {
  for (const it of day.items) {
    if (out.has(it.id)) continue
    let kind = it.kind
    if (it.kind === "final" && it.tone > 0) kind = "vowel-tone"
    if (it.kind === "syllable") kind = it.tone > 0 ? "syllable" : "syllable"
    out.set(it.id, {
      key: it.id,
      kind,
      ph: it.tone > 0 ? `${it.base} ${it.tone}` : it.pinyin,
      text: it.char,
      tone: it.tone || null,
    })
  }
}

const list = [...out.values()]
const target = path.join(root, "src/content/audio-requests.json")
fs.writeFileSync(target, `${JSON.stringify(list, null, 2)}\n`, "utf8")

const byKind = list.reduce((acc, x) => {
  acc[x.kind] = (acc[x.kind] ?? 0) + 1
  return acc
}, {})

console.log(`写了 ${list.length} 条到 ${path.relative(root, target)}`)
console.table(byKind)
