/**
 * Desk protocol v1 helpers for the capture page.
 *
 * The background service worker owns the WebSocket and the desk.capture /
 * desk.catalog-request events. The page only sends STASH_* messages and
 * normalizes whatever comes back so the form never has to know about the
 * wire format.
 */

import { t } from '../../lib/i18n'

export interface StashEntry {
  url: string
  title: string
  body: string
  siteName: string
  cover: string
  captureMethod: 'selection' | 'page'
  truncated: boolean
}

export interface StashCatalog {
  at: string
  tags: string[]
  urls: Record<string, string>
}

export interface StashSavePayload {
  operationId: string
  url: string
  title: string
  body: string
  cover: string
  siteName: string
  tags: string[]
  captureMethod?: 'selection' | 'page'
  truncated?: boolean
  replaceItemId?: string
}

export interface StashSaveResponse {
  ok: boolean
  queued?: boolean
  operationId?: string
  itemId?: string
  duplicate?: boolean
  replaced?: boolean
  error?: string
  markdown?: string
}

const EMPTY_CATALOG: StashCatalog = { at: '', tags: [], urls: {} }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function requestStashEntry(tabId?: number): Promise<{ entry: StashEntry | null; error?: string }> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: 'STASH_EXTRACT',
      ...(tabId ? { payload: { tabId } } : {}),
    })
    if (!isRecord(response)) return { entry: null, error: t('没有收到页面读取结果') }
    if (response.ok === false) {
      return { entry: null, error: typeof response.error === 'string' ? response.error : t('读取当前页失败') }
    }

    const raw = response.entry
    if (!isRecord(raw)) return { entry: null, error: t('当前页没有可收进的内容') }

    return {
      entry: {
        url: typeof raw.url === 'string' ? raw.url : '',
        title: typeof raw.title === 'string' ? raw.title : '',
        body: typeof raw.body === 'string' ? raw.body : '',
        siteName: typeof raw.siteName === 'string' ? raw.siteName : '',
        cover: typeof raw.cover === 'string' ? raw.cover : '',
        captureMethod: raw.captureMethod === 'selection' ? 'selection' : 'page',
        truncated: raw.truncated === true,
      },
    }
  } catch (error) {
    return { entry: null, error: (error as Error).message || t('读取当前页失败') }
  }
}

export async function requestStashCatalog(): Promise<StashCatalog> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'STASH_CATALOG' })
    if (isRecord(response) && response.ok === false) return EMPTY_CATALOG

    const raw = isRecord(response) && isRecord(response.catalog) ? response.catalog : response
    if (!isRecord(raw)) return EMPTY_CATALOG

    const tags = Array.isArray(raw.tags)
      ? Array.from(new Set(raw.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean)))
      : []

    const urls: Record<string, string> = {}
    if (isRecord(raw.urls)) {
      for (const [key, value] of Object.entries(raw.urls)) {
        if (typeof value === 'string' && value) urls[key] = value
      }
    }

    return {
      at: typeof raw.at === 'string' ? raw.at : '',
      tags,
      urls,
    }
  } catch {
    return EMPTY_CATALOG
  }
}

export async function requestStashSave(payload: StashSavePayload): Promise<StashSaveResponse> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'STASH_SAVE', payload })
    if (!isRecord(response)) return { ok: false, error: t('本地服务没有回应') }

    if (response.ok === true) {
      return {
        ok: true,
        queued: response.queued === true,
        operationId: typeof response.operationId === 'string' ? response.operationId : payload.operationId,
        itemId: typeof response.itemId === 'string' ? response.itemId : undefined,
        duplicate: response.duplicate === true,
        replaced: response.replaced === true,
      }
    }

    return {
      ok: false,
      error: typeof response.error === 'string' && response.error ? response.error : t('收进失败，请重试'),
      markdown: typeof response.markdown === 'string' ? response.markdown : undefined,
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message || t('本地服务没有回应') }
  }
}

export async function requestBridgeConnected(): Promise<boolean | null> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' })
    if (!isRecord(response) || response.error) return null
    return response.connected === true
  } catch {
    return null
  }
}

export function createOperationId(): string {
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildFallbackMarkdown(input: { title: string; url: string; body: string }): string {
  return `# ${input.title || ''}\n\n> ${input.url || ''}\n\n${input.body || ''}`
}