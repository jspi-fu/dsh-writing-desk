import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Camera,
  Check,
  Copy,
  Highlighter,
  Info,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { translateAdapterError } from '@/lib/i18n'
import { useI18n } from '../LocaleProvider'
import { captureVisibleTabCover } from '../../lib/capture-cover'
import {
  buildFallbackMarkdown,
  createOperationId,
  requestBridgeConnected,
  requestStashCatalog,
  requestStashEntry,
  requestStashSave,
  type StashCatalog,
} from '../stores/stash'

const MAX_TAGS = 12
const MAX_TAG_LENGTH = 48
const MAX_TITLE_LENGTH = 500
const MAX_BODY_LENGTH = 20_000

const INPUT_CLASS = [
  'h-11 w-full rounded-[18px] border border-border bg-background px-3.5 text-sm',
  'outline-none transition-colors placeholder:text-muted-foreground',
  'focus:border-foreground disabled:opacity-60',
].join(' ')

const SECONDARY_BUTTON_CLASS = [
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-border',
  'bg-background px-3 text-xs font-medium text-foreground transition-colors',
  'hover:bg-muted disabled:opacity-40',
].join(' ')

type PageStatus = 'loading' | 'ready' | 'error'

function hostFrom(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return ''
  }
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-[13px] font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * StashDock-style single-column capture form. The background owns extraction
 * and the Desk socket; this page keeps the editable draft and the conflict /
 * offline fallback states.
 */
export function StashPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  // 侧栏默认读活动标签；fallback 窗口/测试入口可用 ?tab=<id> 指定原页面。
  const sourceTabId = useRef<number | undefined>((() => {
    const raw = new URLSearchParams(window.location.search).get('tab')
    const id = Number(raw)
    return Number.isInteger(id) && id > 0 ? id : undefined
  })())

  const [status, setStatus] = useState<PageStatus>('loading')
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [cover, setCover] = useState<string | null>(null)
  const [siteName, setSiteName] = useState('')
  const [captureMethod, setCaptureMethod] = useState<'selection' | 'page'>('page')
  const [truncated, setTruncated] = useState(false)

  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [catalog, setCatalog] = useState<StashCatalog>({ at: '', tags: [], urls: {} })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [savedItemId, setSavedItemId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const [offlineMarkdown, setOfflineMarkdown] = useState('')
  const [copied, setCopied] = useState(false)
  const [bridgeOffline, setBridgeOffline] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [replaceMode, setReplaceMode] = useState(false)

  const [capturing, setCapturing] = useState(false)
  const [coverError, setCoverError] = useState(false)
  const [notice, setNotice] = useState('')

  // Per-field dirty guards: a background refresh must not overwrite edits.
  const dirty = useRef({ title: false, body: false, tags: false, cover: false })
  const urlRef = useRef('')
  const requestId = useRef(0)
  const started = useRef(false)
  const lastOperationId = useRef('')
  const noticeTimer = useRef<number | null>(null)
  const copyTimer = useRef<number | null>(null)

  const locked = saving || status !== 'ready'

  const showNotice = (text: string) => {
    setNotice(text)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), 4000)
  }

  const markEdited = () => {
    setSaved(false)
    setSaveError('')
    setOfflineMarkdown('')
    setCopied(false)
    setNotice('')
  }

  const loadEntry = async (mode: 'initial' | 'refresh') => {
    const id = ++requestId.current
    if (mode === 'initial') setStatus('loading')
    else setRefreshing(true)
    setLoadError('')

    const result = await requestStashEntry(sourceTabId.current)
    if (id !== requestId.current) return

    if (!result.entry) {
      if (mode === 'initial') {
        setStatus('error')
        setLoadError(result.error || '当前页无法读取')
      } else {
        setRefreshing(false)
        showNotice(result.error || '刷新失败，请重试')
      }
      return
    }

    const entry = result.entry
    const changedUrl = entry.url !== urlRef.current
    if (changedUrl) dirty.current = { title: false, body: false, tags: false, cover: false }
    urlRef.current = entry.url

    setUrl(entry.url)
    setSiteName(entry.siteName)
    setCaptureMethod(entry.captureMethod)
    setTruncated(entry.truncated)
    if (changedUrl || !dirty.current.title) setTitle(entry.title.slice(0, MAX_TITLE_LENGTH))
    if (changedUrl || !dirty.current.body) setBody(entry.body.slice(0, MAX_BODY_LENGTH))
    if (changedUrl || !dirty.current.cover) setCover(entry.cover || null)
    if (changedUrl) {
      setTags([])
      setTagInput('')
    }

    setStatus('ready')
    setRefreshing(false)
    setSaved(false)
    if (changedUrl) setSavedItemId(null)
    setReplaceMode(false)
    setConflictOpen(false)
    setSaveError('')
    setOfflineMarkdown('')
    setCopied(false)
    setCoverError(false)
    setNotice('')
  }

  const checkBridge = async () => {
    const connected = await requestBridgeConnected()
    if (connected !== null) setBridgeOffline(!connected)
  }

  const onTitleChange = (value: string) => {
    dirty.current.title = true
    setTitle(value)
    markEdited()
  }

  const onBodyChange = (value: string) => {
    dirty.current.body = true
    setBody(value)
    markEdited()
  }

  const addTag = (raw: string) => {
    const value = raw.trim().replace(/^#/, '').trim().slice(0, MAX_TAG_LENGTH)
    if (!value) {
      setTagInput('')
      return
    }
    if (tags.includes(value)) {
      setTagInput('')
      return
    }
    if (tags.length >= MAX_TAGS) {
      showNotice(t('最多添加 {max} 个标签', { max: MAX_TAGS }))
      return
    }

    dirty.current.tags = true
    setTags([...tags, value])
    setTagInput('')
    markEdited()
  }

  const removeTag = (tag: string) => {
    dirty.current.tags = true
    setTags(tags.filter(item => item !== tag))
    markEdited()
  }

  const removeCover = () => {
    dirty.current.cover = true
    setCover(null)
    markEdited()
  }

  const captureCover = async () => {
    if (capturing || locked) return
    setCapturing(true)
    setCoverError(false)
    const dataUrl = await captureVisibleTabCover()
    setCapturing(false)
    if (!dataUrl) {
      setCoverError(true)
      return
    }

    dirty.current.cover = true
    setCover(dataUrl)
    markEdited()
  }

  const copyMarkdown = async () => {
    const text = offlineMarkdown || buildFallbackMarkdown({ title: title.trim(), url, body })
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      showNotice('复制失败，请手动选择正文')
    }
  }

  const knownItemId = catalog.urls[url] || savedItemId || undefined

  const submitSave = async (replaceItemId?: string) => {
    const cleanTitle = title.trim()
    const operationId = createOperationId()
    lastOperationId.current = operationId
    const payload = {
      operationId,
      url,
      title: cleanTitle,
      body,
      cover: cover || '',
      siteName,
      tags,
      captureMethod,
      truncated,
      ...(replaceItemId ? { replaceItemId } : {}),
    }

    setSaving(true)
    setSaveError('')
    setOfflineMarkdown('')
    setCopied(false)
    setNotice('')

    const response = await requestStashSave(payload)
    setSaving(false)

    if (response.ok) {
      setSaved(true)
      setConflictOpen(false)
      setReplaceMode(false)
      setBridgeOffline(false)
      const itemId = response.itemId
      if (itemId) {
        setSavedItemId(itemId)
        setCatalog(previous => ({
          ...previous,
          urls: { ...previous.urls, [url]: itemId },
        }))
      }
      // DSH 没开着:收录已原子落盘,启动后上墙(ADR 0012,不再降级复制 Markdown)
      if (response.dshActive === false) showNotice('已收录。图文创作台没在运行，它下次启动后会出现在灵感墙')
      return
    }

    setSaveError(response.error || '收录失败，请重试')
    setOfflineMarkdown(response.markdown || buildFallbackMarkdown({ title: cleanTitle, url, body }))
    void checkBridge()
  }

  const handleSave = async () => {
    if (saving || saved || status !== 'ready') return
    if (!title.trim()) return

    if (knownItemId && !replaceMode) {
      setConflictOpen(true)
      return
    }

    await submitSave(replaceMode ? knownItemId : undefined)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleSave()
  }

  const keepExisting = () => {
    setConflictOpen(false)
    showNotice('已保留原条目，本次未收录')
  }

  const confirmReplace = () => {
    const replaceItemId = knownItemId
    setConflictOpen(false)
    setReplaceMode(true)
    void submitSave(replaceItemId)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void loadEntry('initial')
    void (async () => {
      setCatalog(await requestStashCatalog())
    })()
    void checkBridge()
  }, [])

  useEffect(() => {
    if (!conflictOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConflictOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [conflictOpen])

  // 收录回执实时回推(长端口,ADR 0012):DSH 在跑时卡片几秒内上墙,这里把 itemId
  // 记下来供冲突判断;消化失败或判重也如实告知,不让「已收录」冒充成功。
  useEffect(() => {
    const listener = (message: unknown) => {
      const msg = message as { type?: unknown; payload?: Record<string, unknown> }
      if (msg?.type !== 'BRIDGE_CAPTURE_RESULT' || typeof msg.payload !== 'object' || msg.payload === null) return
      const payload = msg.payload as { operationId?: unknown; ok?: unknown; itemId?: unknown; duplicate?: unknown; error?: unknown }
      if (typeof payload.operationId === 'string' && payload.operationId !== lastOperationId.current) return
      if (payload.ok !== true) {
        showNotice(typeof payload.error === 'string' && payload.error
          ? `${t('收录没有被工作台收下')}：${payload.error}`
          : t('收录没有被工作台收下'))
        return
      }
      const itemId = typeof payload.itemId === 'string' ? payload.itemId : null
      if (itemId) {
        setSavedItemId(itemId)
        setCatalog(previous => ({ ...previous, urls: { ...previous.urls, [urlRef.current]: itemId } }))
      }
      if (payload.duplicate === true) showNotice(t('这条链接已经收录过，没有重复建卡'))
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
  }, [])

  const hostLabel = siteName || hostFrom(url)
  const suggestions = catalog.tags.filter(tag =>
    tag.length > 0 && tag.length <= MAX_TAG_LENGTH && !tags.includes(tag)
  )
  const saveDisabled = saving || saved || status !== 'ready' || !title.trim()
  const refreshBusy = refreshing || status === 'loading'

  return (
    <>
      <div className="h-full overflow-y-auto">
        <form onSubmit={handleSubmit} className="flex min-h-full flex-col">
          <div className="mx-auto w-full max-w-[560px] flex-1 px-4 pb-5 pt-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-semibold tracking-tight">{t('收录当前页')}</h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={hostLabel}>
                  {/* 错误态下方有完整错误卡,副题只在有信息时出现 */}
                  {hostLabel || (status === 'loading' ? t('正在读取当前标签页…') : status === 'ready' ? t('尚未读取页面') : '')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadEntry(status === 'error' ? 'initial' : 'refresh')}
                disabled={refreshBusy || saving || capturing}
                aria-label={t('刷新当前页')}
                title={t('刷新')}
                className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className={cn('h-4 w-4', refreshBusy && 'animate-spin')}  strokeWidth={1.6} />
              </button>
            </div>

            {bridgeOffline && (
              <div className="mb-4 rounded-[18px] border border-border bg-muted/40 px-3.5 py-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"  strokeWidth={1.6} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{t('本地助手未配对')}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {t('重启一次 DeepSeek Harness 会自动修复注册，并确认本机装有 Node.js；详情见设置页的连接状态。')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void checkBridge()} className={SECONDARY_BUTTON_CLASS}>
                        {t('重新检查')}
                      </button>
                      <button type="button" onClick={() => navigate('/settings')} className={SECONDARY_BUTTON_CLASS}>
                        <Settings className="h-3.5 w-3.5"  strokeWidth={1.6} />
                        {t('打开设置')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {status === 'loading' ? (
              <div className="space-y-4" role="status" aria-label={t('正在读取当前页')}>
                <div className="h-11 animate-pulse rounded-[18px] bg-muted" />
                <div className="h-11 animate-pulse rounded-[18px] bg-muted" />
                <div className="h-[184px] animate-pulse rounded-[18px] bg-muted" />
                <div className="aspect-video animate-pulse rounded-[18px] bg-muted" />
                <div className="h-11 animate-pulse rounded-[18px] bg-muted" />
              </div>
            ) : status === 'error' ? (
              <div className="rounded-[18px] border border-border bg-card p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"  strokeWidth={1.6} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t('无法读取当前页')}</p>
                    <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                      {translateAdapterError(loadError) || t('请打开一个网页后重试。')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadEntry('initial')}
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[14px] border border-border px-3 text-xs font-medium transition-colors hover:bg-muted"
                >
                  <RefreshCw className="h-3.5 w-3.5"  strokeWidth={1.6} />
                  {t('重新读取')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {captureMethod === 'selection' && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground">
                    <Highlighter className="h-3.5 w-3.5"  strokeWidth={1.6} />
                    {t('已采集当前选区')}
                  </div>
                )}

                <Field label={t('链接')} htmlFor="stash-url">
                  <div className="relative">
                    <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"  strokeWidth={1.6} />
                    <input
                      id="stash-url"
                      type="url"
                      value={url}
                      readOnly
                      onFocus={event => event.currentTarget.select()}
                      title={url}
                      placeholder="https://example.com/article"
                      className={cn(INPUT_CLASS, 'cursor-text bg-muted/40 pl-10 text-muted-foreground')}
                    />
                  </div>
                </Field>

                <Field label={t('标题')} htmlFor="stash-title">
                  <input
                    id="stash-title"
                    type="text"
                    value={title}
                    onChange={event => onTitleChange(event.target.value)}
                    disabled={locked}
                    maxLength={MAX_TITLE_LENGTH}
                    placeholder={t('文章标题')}
                    autoFocus
                    className={cn(INPUT_CLASS, 'font-article-serif text-[15px]')}
                  />
                </Field>

                <Field label={t('正文')} htmlFor="stash-body">
                  <textarea
                    id="stash-body"
                    value={body}
                    onChange={event => onBodyChange(event.target.value)}
                    disabled={locked}
                    maxLength={MAX_BODY_LENGTH}
                    placeholder={t('粘贴或输入 Markdown 正文')}
                    className={cn(INPUT_CLASS, 'min-h-[170px] resize-y py-3 leading-relaxed')}
                  />
                  {truncated && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      <Info className="mt-px h-3.5 w-3.5 flex-none"  strokeWidth={1.6} />
                      {t('正文较长，已按可采集范围截断，可手动补全。')}
                    </p>
                  )}
                </Field>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">{t('封面')}</span>
                    <button
                      type="button"
                      onClick={() => void captureCover()}
                      disabled={locked || capturing}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      {capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin"  strokeWidth={1.6} /> : <Camera className="h-3.5 w-3.5"  strokeWidth={1.6} />}
                      {capturing ? t('截取中…') : t('截取当前页')}
                    </button>
                  </div>
                  <div className="relative aspect-video w-full overflow-hidden rounded-[18px] border border-border/70 bg-muted/40">
                    {cover ? (
                      <>
                        <img src={cover} alt={t('封面预览')} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={removeCover}
                          disabled={locked}
                          aria-label={t('移除封面')}
                          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/70 disabled:opacity-40"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                        <Camera className="h-5 w-5"  strokeWidth={1.6} />
                        <span className="text-[11px]">{t('暂无封面')}</span>
                      </div>
                    )}
                  </div>
                  {coverError && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">{t('截取失败，可重试或留空。')}</p>
                  )}
                </div>

                <Field label={t('标签')} htmlFor="stash-tags">
                  <div
                    className={cn(
                      'min-h-11 rounded-[18px] border border-border bg-background px-2 py-1.5 transition-colors focus-within:border-foreground',
                      locked && 'opacity-60'
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {tags.map(tag => (
                        <span
                          key={tag}
                          className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-muted px-2.5 text-xs"
                        >
                          <span className="max-w-[220px] truncate">{tag}</span>
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            disabled={locked}
                            aria-label={t('移除标签 {tag}', { tag })}
                            className="text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                      <input
                        id="stash-tags"
                        type="text"
                        value={tagInput}
                        onChange={event => setTagInput(event.target.value)}
                        onKeyDown={event => {
                          if (event.key !== 'Enter') return
                          event.preventDefault()
                          if (event.nativeEvent.isComposing) return
                          addTag(tagInput)
                        }}
                        disabled={locked || tags.length >= MAX_TAGS}
                        maxLength={MAX_TAG_LENGTH}
                        placeholder={
                          tags.length >= MAX_TAGS
                            ? t('已达 {max} 个标签上限', { max: MAX_TAGS })
                            : tags.length
                              ? t('继续添加…')
                              : t('输入标签，回车添加')
                        }
                        className="h-8 min-w-[110px] flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:pointer-events-none"
                      />
                    </div>
                  </div>
                  {suggestions.length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1.5 text-[11px] text-muted-foreground">{t('工作台已有标签')}</p>
                      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                        {suggestions.map(tag => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => addTag(tag)}
                            disabled={locked || tags.length >= MAX_TAGS}
                            className="inline-flex h-7 items-center gap-1 rounded-full border border-border/70 px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
                          >
                            <Plus className="h-3 w-3"  strokeWidth={1.6} />
                            <span className="max-w-[180px] truncate">{tag}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </Field>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 border-t border-border/70 bg-background px-4 pb-3 pt-3">
            <div className="mx-auto w-full max-w-[560px]">
              {saveError && (
                <div className="mb-2.5 rounded-[14px] border border-destructive/25 bg-destructive/5 px-3 py-2.5">
                  <p role="alert" className="break-words text-[12px] leading-relaxed text-destructive">
                    {translateAdapterError(saveError)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copyMarkdown()} className={SECONDARY_BUTTON_CLASS}>
                      <Copy className="h-3.5 w-3.5"  strokeWidth={1.6} />
                      {copied ? t('已复制 Markdown') : t('复制 Markdown')}
                    </button>
                    {bridgeOffline && (
                      <button type="button" onClick={() => navigate('/settings')} className={SECONDARY_BUTTON_CLASS}>
                        <Settings className="h-3.5 w-3.5"  strokeWidth={1.6} />
                        {t('打开设置')}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {notice && (
                <p role="status" className="mb-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                  {t(notice)}
                </p>
              )}
              <button
                type="submit"
                disabled={saveDisabled}
                aria-busy={saving}
                className={cn(
                  'flex h-11 w-full items-center justify-center gap-2 rounded-[18px] text-sm font-medium transition-colors',
                  saved
                    ? 'cursor-default bg-muted text-muted-foreground'
                    : 'bg-foreground text-background hover:opacity-90 disabled:opacity-40'
                )}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin"  strokeWidth={1.6} />
                    {t('收录中…')}
                  </>
                ) : saved ? (
                  <>
                    <Check className="h-4 w-4"  strokeWidth={1.6} />
                    {t('已收录')}
                  </>
                ) : (
                  t('收录至工作台')
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {conflictOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setConflictOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="stash-conflict-title"
            className="w-full max-w-[340px] rounded-[18px] border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          >
            <h3 id="stash-conflict-title" className="text-[15px] font-semibold">
              {t('这个页面已经收录过')}
            </h3>
            <p className="mt-1.5 break-words text-xs leading-relaxed text-muted-foreground">
              {t('「{title}」已存在工作台中。保留原条目，还是用当前内容替换？', {
                title: title.trim() || t('当前页面'),
              })}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={keepExisting}
                autoFocus
                className="h-11 flex-1 rounded-[18px] border border-border bg-background text-sm font-medium transition-colors hover:bg-muted"
              >
                {t('保留原条目')}
              </button>
              <button
                type="button"
                onClick={confirmReplace}
                disabled={saving}
                className="h-11 flex-1 rounded-[18px] bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {t('替换')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}