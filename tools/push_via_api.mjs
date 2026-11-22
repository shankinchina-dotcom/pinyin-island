/**
 * 在没有 git 传输（HTTPS 被墙）的情况下，用 GitHub Git Data API 提交一次快照。
 * 用法：node tools/push_via_api.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const OWNER = 'shankinchina-dotcom'
const REPO = 'pinyin-island'
const BRANCH = 'main'
const TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
const ROOT = process.cwd()

const api = async (method, endpoint, body) => {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: ROOT })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)

console.log(`文件数 ${files.length}`)

const entries = []
for (const [i, rel] of files.entries()) {
  const buf = fs.readFileSync(path.join(ROOT, rel))
  const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  })
  entries.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha })
  if ((i + 1) % 25 === 0) console.log(`  已上传 ${i + 1}/${files.length}`)
}

const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: entries })
console.log('tree', tree.sha)

const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: '拼音岛：给 6 岁孩子的拼音学习网站（真人发音 · 3D 小猫 · 23 天闯关）',
  tree: tree.sha,
  parents: [],
  author: { name: 'shankluo', email: 'shankinchina-dotcom@users.noreply.github.com', date: new Date().toISOString() },
  committer: { name: 'shankluo', email: 'shankinchina-dotcom@users.noreply.github.com', date: new Date().toISOString() },
})
console.log('commit', commit.sha)

await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true })
console.log('ref updated ->', commit.sha.slice(0, 7))
