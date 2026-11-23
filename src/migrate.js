// 从「自媒体工作台」(dsh-media-desk) 迁移灵感与排期。
// 只搬内容:灵感条目、标签、状态、时间、封面/媒体、平台,以及角度与读者按名字合并;
// 账号、指标、技能、对话不迁。写入前由 host 把媒体文件复制进 writing-desk/files。
import { STATUSES } from './state.js'
import { PLATFORMS } from './platforms.js'
import { isHttpUrl } from './url.js'

const KIND = { image: 'image', video: 'video', web: 'web', note: 'note', quote: 'note' }
const PLATFORM_SET = new Set(PLATFORMS)
const LIMIT_TAGS = 24
const SELECTION = ['items', 'schedule', 'angles', 'people', 'styles']

/** 迁移前的勾选:缺省全选;只有明确 false 才跳过,别让旧客户端的一次空对象搬空数据。 */
function normalizeSelection(selection) {
  const picked = {}
  for (const key of SELECTION) picked[key] = selection?.[key] !== false
  return picked
}

const text = value => typeof value === 'string' ? value : ''
const iso = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null
const http = value => isHttpUrl(value) ? value : null
const list = value => Array.isArray(value) ? value.filter(row => typeof row === 'string' && row.trim()).map(row => row.trim()) : []

/** 概览:先让用户看清要搬多少东西,再决定。 */
export function summarizeMediaDesk(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : []
  const kinds = {}
  for (const item of items) {
    const kind = KIND[item?.kind] ?? 'note'
    kinds[kind] = (kinds[kind] ?? 0) + 1
  }
  return {
    total: items.length,
    kinds,
    samples: items.filter(item => item?.sample).length,
    media: items.filter(item => item?.media?.src).length,
    scheduled: items.filter(item => item?.scheduledAt).length,
    published: items.filter(item => item?.status === 'published').length,
    angles: Array.isArray(raw?.angles) ? raw.angles.length : 0,
    people: Array.isArray(raw?.people) ? raw.people.length : 0,
    styles: Array.isArray(raw?.styles) ? raw.styles.length : 0,
  }
}

function mergeByName(existing, incoming, fields) {
  const byName = new Map(existing.filter(row => typeof row.name === 'string').map(row => [row.name, row]))
  for (const source of incoming) {
    const name = text(source?.name).trim()
    if (!name) continue
    const target = byName.get(name)
    if (target) {
      // 已有同名实体只补空字段,不覆盖用户改过的内容
      for (const field of fields) {
        if ((target[field] === undefined || target[field] === '') && source[field] !== undefined) target[field] = source[field]
      }
      continue
    }
    const row = { ...source, id: `md-${text(source.id) || name}` }
    existing.push(row)
    byName.set(name, row)
  }
  return byName
}

/**
 * 把媒体工作台的条目并入写作台状态。同一条源数据重复迁移时按 `md-<id>` 跳过,不重复添加。
 * 迁移是复制:源数据与媒体文件都不动;用户可以不勾某些分组,只搬自己要的部分。
 * @param {object} state - 写作台状态,会被就地修改。
 * @param {object} raw - 媒体工作台 state.json。
 * @param {{media?: Map<string, object>, now?: string, selection?: object}} [options]
 * @returns {{added:number, skipped:number, missingMedia:number}}
 */
export function migrateMediaDesk(state, raw, { media = new Map(), now = new Date().toISOString(), selection } = {}) {
  const picked = normalizeSelection(selection)
  const items = picked.items && Array.isArray(raw?.items) ? raw.items : []
  const people = picked.people
    ? mergeByName(Array.isArray(state.people) ? state.people : (state.people = []), Array.isArray(raw?.people) ? raw.people : [], ['role', 'note', 'traits', 'tone'])
    : new Map((Array.isArray(state.people) ? state.people : []).filter(row => typeof row?.name === 'string').map(row => [row.name, row]))
  const angles = picked.angles
    ? mergeByName(Array.isArray(state.angles) ? state.angles : (state.angles = []), Array.isArray(raw?.angles) ? raw.angles : [], ['hook', 'prompt'])
    : new Map((Array.isArray(state.angles) ? state.angles : []).filter(row => typeof row?.name === 'string').map(row => [row.name, row]))
  const styles = picked.styles
    ? mergeByName(Array.isArray(state.styles) ? state.styles : (state.styles = []), Array.isArray(raw?.styles) ? raw.styles : [], ['icon', 'summary', 'tone', 'sentences', 'opening', 'structure', 'words', 'avoid', 'samples'])
    : new Map((Array.isArray(state.styles) ? state.styles : []).filter(row => typeof row?.name === 'string').map(row => [row.name, row]))
  const styleId = raw?.activeStyleId
  if (picked.styles && styleId && Array.isArray(raw?.styles)) {
    const source = raw.styles.find(row => row?.id === styleId)
    const target = source && styles.get(text(source.name))
    if (target && target.id !== state.activeStyleId) state.activeStyleId = target.id
  }
  const ids = new Set((Array.isArray(state.items) ? state.items : []).map(row => row?.id))
  const usedAngles = new Map()
  let added = 0
  let skipped = 0
  let missingMedia = 0
  for (const source of items) {
    const id = `md-${text(source?.id).replace(/[^\w.-]/g, '') || `${added}-${items.indexOf(source)}`}`
    if (ids.has(id)) { skipped += 1; continue }
    const mapped = source?.media?.src ? media.get(source.media.src) : null
    const poster = source?.media?.poster ? media.get(source.media.poster) : null
    if (source?.media?.src && !mapped) missingMedia += 1
    let angleId = null
    if (picked.angles && source?.angleId) {
      if (!usedAngles.has(source.angleId)) {
        const sourceAngle = Array.isArray(raw?.angles) ? raw.angles.find(row => row?.id === source.angleId) : null
        usedAngles.set(source.angleId, sourceAngle ? angles.get(text(sourceAngle.name))?.id ?? null : null)
      }
      angleId = usedAngles.get(source.angleId)
    }
    const personaIds = picked.people ? list(source?.personaIds).map(pid => {
      const sourcePerson = Array.isArray(raw?.people) ? raw.people.find(row => row?.id === pid) : null
      return sourcePerson ? people.get(text(sourcePerson.name))?.id : null
    }).filter(Boolean) : []
    const kind = KIND[source?.kind] ?? 'note'
    state.items.push({
      id,
      kind,
      title: text(source?.title).slice(0, 500),
      body: text(source?.body).slice(0, 40000),
      tags: [...new Set(list(source?.tags))].slice(0, LIMIT_TAGS),
      status: picked.schedule && STATUSES.includes(source?.status) ? source.status : 'idea',
      angleId,
      personaIds,
      media: mapped ? { ...mapped, ...(poster?.src ? { poster: poster.src } : {}), ...(Number.isFinite(source.media?.w) ? { w: source.media.w } : {}), ...(Number.isFinite(source.media?.h) ? { h: source.media.h } : {}), ...(text(source.media?.name) ? { name: text(source.media.name).slice(0, 160) } : {}) } : null,
      url: http(source?.url),
      source: text(source?.source).slice(0, 500),
      createdAt: iso(source?.createdAt) ?? now,
      scheduledAt: picked.schedule ? iso(source?.scheduledAt) : null,
      platform: picked.schedule && PLATFORM_SET.has(source?.platform) ? source.platform : null,
      contentOrigin: 'user',
      sample: source?.sample === true,
    })
    ids.add(id)
    added += 1
  }
  state.migrations = { ...(state.migrations ?? {}), 'dsh-media-desk': now }
  // 迁移后补一次排序,墙面时间线按收藏时间自然落位
  state.items.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
  return { added, skipped, missingMedia }
}