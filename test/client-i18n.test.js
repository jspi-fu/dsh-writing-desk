// client 词典的一致性守卫:
// 1) 代码里每个 t('…') 字面量都要有词条——否则英文界面回落中文;
// 2) 词典里每个 key 都要能从代码字面量或共享常量到达——否则是退役功能留下的死词条;
// 3) core/pages/studio 三个词典不允许重复 key——展开顺序会悄悄改变生效译文。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CORE } from '../client/en/core.js'
import { PAGES } from '../client/en/pages.js'
import { STUDIO } from '../client/en/studio.js'
import { EN } from '../client/en/index.js'
import { BRIDGE_ADAPTERS, PLATFORMS } from '../src/platforms.js'
import { STYLE_CATEGORIES } from '../src/style-presets.js'
import { STATUS_LABEL } from '../src/state.js'
import { PUBLICATION_LABEL } from '../src/work.js'

const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/
const unescape = s => s.replaceAll("\\'", "'").replaceAll('\\"', '"').replaceAll('\\n', '\n')
// 这些中文常量经共享纯模块动态拼成 t() key,不会以字面量出现在 client 源码里
const whitelist = new Set([...PLATFORMS, ...Object.values(BRIDGE_ADAPTERS), ...Object.values(STATUS_LABEL), ...Object.values(PUBLICATION_LABEL), ...STYLE_CATEGORIES])

function clientFiles() {
  const files = []
  const walk = dir => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${name.name}`
      if (name.isDirectory()) { if (!p.includes('/en')) walk(p); continue }
      if (/\.(js|jsx)$/.test(name.name)) files.push(p)
    }
  }
  walk(fileURLToPath(new URL('../client/', import.meta.url)))
  return files
}

test('client 的 t() 字面量都有英文词条', () => {
  const used = new Set()
  for (const file of clientFiles()) {
    const code = readFileSync(file, 'utf8')
    for (const match of code.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) used.add(unescape(match[1]))
  }
  const missing = [...used].filter(key => !(key in EN))
  assert.deepEqual(missing, [], '这些 t() 字面量在 client/en 里没有词条')
})

test('client 词典没有死词条', () => {
  const literals = new Set()
  for (const file of clientFiles()) {
    const code = readFileSync(file, 'utf8')
    for (const match of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) { const raw = unescape(match[1]); if (CJK.test(raw)) literals.add(raw) }
    for (const match of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) { const raw = unescape(match[1]); if (CJK.test(raw)) literals.add(raw) }
    for (const match of code.matchAll(/`([^`]*)`/g)) { const raw = match[1].replace(/\$\{[^}]*\}/g, 'X'); if (CJK.test(raw)) literals.add(raw) }
  }
  for (const literal of [...literals]) literals.add(`${literal}|1`)
  const dead = Object.keys(EN).filter(key => !literals.has(key) && !whitelist.has(key))
  assert.deepEqual(dead, [], '这些词条没有任何代码路径能到达')
})

test('core/pages/studio 三个词典互不重复', () => {
  const seen = new Map()
  const repeats = []
  for (const [name, dict] of [['core', CORE], ['pages', PAGES], ['studio', STUDIO]]) {
    for (const key of Object.keys(dict)) {
      if (seen.has(key)) repeats.push(`${key}: ${seen.get(key)} 与 ${name}`)
      seen.set(key, name)
    }
  }
  assert.deepEqual(repeats, [], '重复 key 会被展开顺序悄悄覆盖')
})
