import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Plug,
  PlugZap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LanguagePreference } from '@/lib/i18n'
import { platformDisplayName } from '@/lib/platform-names'
import { useI18n } from '../LocaleProvider'

const HIDDEN_PLATFORMS_KEY = 'hiddenPlatforms'
const SERVE_COMMAND = 'dswritesync serve'

const LANGUAGE_OPTIONS: { value: LanguagePreference; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

interface PlatformInfo {
  id: string
  name: string
  icon: string
  isAuthenticated: boolean
}

interface BridgeStatus {
  enabled: boolean
  connected: boolean
  hasToken: boolean
  tokenTail: string
  serverUrl: string
  lastError: string | null
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
    </section>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        'relative h-6 w-11 flex-shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'absolute top-1 h-4 w-4 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-6 bg-primary-foreground' : 'translate-x-1 bg-white'
        )}
      />
    </button>
  )
}

/**
 * Shared settings page, reached from the header gear. Capture and sync both
 * read the same preferences.
 */
export function SettingsPage() {
  const navigate = useNavigate()
  const { t, preference, setPreference } = useI18n()
  const [view, setView] = useState<'main' | 'platforms'>('main')
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({
    enabled: false,
    connected: false,
    hasToken: false,
    tokenTail: '',
    serverUrl: '',
    lastError: null,
  })
  const [cmsAccountCount, setCmsAccountCount] = useState(0)
  const [floatingButtonEnabled, setFloatingButtonEnabled] = useState(false)
  const [deepCleanEnabled, setDeepCleanEnabled] = useState(false)
  const [serverUrlInput, setServerUrlInput] = useState('')
  const serverUrlTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [allPlatforms, setAllPlatforms] = useState<PlatformInfo[]>([])
  const [hiddenPlatforms, setHiddenPlatforms] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [tokenBusy, setTokenBusy] = useState(false)
  const [tokenNotice, setTokenNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  const applyBridgeStatus = (response: any) => {
    if (!response || response.error) return
    setBridgeStatus({
      enabled: response.enabled ?? false,
      connected: response.connected ?? false,
      hasToken: response.hasToken ?? false,
      tokenTail: response.tokenTail ?? '',
      serverUrl: response.serverUrl ?? '',
      lastError: response.lastError ?? null,
    })
  }

  const refreshBridgeStatus = () => {
    chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' }, applyBridgeStatus)
  }

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' }, response => {
      if (response && !response.error) {
        applyBridgeStatus(response)
        setServerUrlInput(response.serverUrl || '')
      }
    })

    chrome.storage.local.get(
      ['cmsAccounts', 'floatingButtonEnabled', 'deepCleanEnabled', HIDDEN_PLATFORMS_KEY],
      result => {
        setCmsAccountCount((result.cmsAccounts || []).length)
        setFloatingButtonEnabled(result.floatingButtonEnabled ?? false)
        setDeepCleanEnabled(result.deepCleanEnabled ?? false)
        setHiddenPlatforms(new Set(result[HIDDEN_PLATFORMS_KEY] || []))
      }
    )

    // 先渲染缓存，再等登录态检查回包
    chrome.storage.local.get('platformListCache', result => {
      if (result.platformListCache?.length) {
        setAllPlatforms(prev => prev.length ? prev : result.platformListCache.map((p: any) => ({
          id: p.id, name: p.name, icon: p.icon, isAuthenticated: p.isAuthenticated,
        })))
      }
    })
    chrome.runtime.sendMessage(
      { type: 'CHECK_ALL_AUTH', payload: { forceRefresh: false } },
      response => {
        if (response?.platforms?.length) {
          setAllPlatforms(response.platforms.map((p: any) => ({
            id: p.id, name: p.name, icon: p.icon, isAuthenticated: p.isAuthenticated,
          })))
        }
      }
    )

    return () => {
      if (serverUrlTimer.current) clearTimeout(serverUrlTimer.current)
    }
  }, [])

  // 设置页打开期间加速本地服务重连；离开时恢复正常重连策略
  useEffect(() => {
    if (!bridgeStatus.enabled) return

    chrome.runtime.sendMessage({ type: 'BRIDGE_WATCH_START' })
    const interval = setInterval(refreshBridgeStatus, 3000)

    return () => {
      clearInterval(interval)
      chrome.runtime.sendMessage({ type: 'BRIDGE_WATCH_STOP' })
    }
  }, [bridgeStatus.enabled])

  const toggleBridge = () => {
    const enabling = !bridgeStatus.enabled

    chrome.runtime.sendMessage({ type: enabling ? 'BRIDGE_ENABLE' : 'BRIDGE_DISABLE' }, response => {
      if (response?.needToken) {
        setTokenNotice({ tone: 'error', text: '请先粘贴工作台设置页显示的 Token' })
        return
      }
      if (!response?.success) {
        if (response?.error) setTokenNotice({ tone: 'error', text: response.error })
        return
      }
      setTokenNotice(null)
      refreshBridgeStatus()
    })
  }

  const saveToken = () => {
    const token = tokenInput.trim()
    if (token.length < 16) {
      setTokenNotice({ tone: 'error', text: 'Token 至少 16 个字符' })
      return
    }

    setTokenBusy(true)
    chrome.runtime.sendMessage({ type: 'BRIDGE_SET_TOKEN', payload: { token } }, response => {
      setTokenBusy(false)
      if (!response?.success) {
        setTokenNotice({ tone: 'error', text: response?.error || '保存失败' })
        return
      }
      setTokenInput('')
      setTokenNotice({ tone: 'info', text: 'Token 已保存' })
      refreshBridgeStatus()
    })
  }

  const clearToken = () => {
    setTokenBusy(true)
    chrome.runtime.sendMessage({ type: 'BRIDGE_CLEAR_TOKEN' }, response => {
      setTokenBusy(false)
      if (!response?.success) {
        setTokenNotice({ tone: 'error', text: response?.error || '清除失败' })
        return
      }
      setTokenNotice({ tone: 'info', text: 'Token 已清除' })
      refreshBridgeStatus()
    })
  }

  const handleServerUrlChange = (value: string) => {
    setServerUrlInput(value)
    if (serverUrlTimer.current) clearTimeout(serverUrlTimer.current)
    serverUrlTimer.current = setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'BRIDGE_SET_SERVER_URL',
        payload: { url: value.trim() },
      })
      setBridgeStatus(prev => ({ ...prev, serverUrl: value.trim() }))
    }, 800)
  }

  const copyServeCommand = async () => {
    try {
      await navigator.clipboard.writeText(SERVE_COMMAND)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = SERVE_COMMAND
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleFloatingButton = () => {
    const next = !floatingButtonEnabled
    setFloatingButtonEnabled(next)
    chrome.storage.local.set({ floatingButtonEnabled: next })
  }

  const toggleDeepClean = () => {
    const next = !deepCleanEnabled
    setDeepCleanEnabled(next)
    chrome.storage.local.set({ deepCleanEnabled: next })
  }

  const togglePlatformVisibility = (platformId: string) => {
    setHiddenPlatforms(prev => {
      const next = new Set(prev)
      if (next.has(platformId)) {
        next.delete(platformId)
      } else {
        next.add(platformId)
      }
      chrome.storage.local.set({ [HIDDEN_PLATFORMS_KEY]: Array.from(next) })
      return next
    })
  }

  const showAllPlatforms = () => {
    setHiddenPlatforms(new Set())
    chrome.storage.local.set({ [HIDDEN_PLATFORMS_KEY]: [] })
  }

  const hideAllPlatforms = () => {
    const all = new Set(allPlatforms.map(p => p.id))
    setHiddenPlatforms(all)
    chrome.storage.local.set({ [HIDDEN_PLATFORMS_KEY]: Array.from(all) })
  }

  // 按当前列表过滤计算，避免 hiddenPlatforms 含已下线平台时计数偏小甚至为负
  const shownCount = allPlatforms.filter(p => !hiddenPlatforms.has(p.id)).length

  const connectionStatus = !bridgeStatus.enabled
    ? t('未启用')
    : bridgeStatus.connected
      ? t('已连接')
      : bridgeStatus.hasToken
        ? t('等待连接…')
        : t('未设置 Token')

  const [serveHintBefore, serveHintAfter] = t(
    '由 {command} 在本机启动。工作台设置页显示 Token，粘贴到这里。'
  ).split('{command}')

  if (view === 'platforms') {
    return (
      <div className="flex h-full flex-col">
        <header className="flex flex-none items-center gap-2 border-b border-border/70 px-4 py-3">
          <button
            onClick={() => setView('main')}
            aria-label={t('返回设置')}
            className="-ml-1 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold">{t('常用平台')}</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {shownCount}/{allPlatforms.length}
          </span>
        </header>

        <div className="flex flex-none items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <button onClick={showAllPlatforms} className="text-xs font-medium underline-offset-2 hover:underline">
            {t('全选')}
          </button>
          <span className="text-xs text-muted-foreground">·</span>
          <button onClick={hideAllPlatforms} className="text-xs font-medium underline-offset-2 hover:underline">
            {t('全不选')}
          </button>
          <p className="ml-auto text-[11px] text-muted-foreground">{t('点击切换显示')}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {allPlatforms.map(platform => {
            const isHidden = hiddenPlatforms.has(platform.id)
            return (
              <button
                key={platform.id}
                type="button"
                onClick={() => togglePlatformVisibility(platform.id)}
                className={cn(
                  'flex min-h-[44px] w-full items-center gap-2.5 border-b border-border/50 px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40',
                  isHidden && 'opacity-40'
                )}
              >
                <img
                  src={platform.icon}
                  alt=""
                  className="h-5 w-5 flex-shrink-0 rounded"
                  onError={event => { (event.target as HTMLImageElement).src = '/assets/icon-48.png' }}
                />
                <span className="flex-1 truncate text-sm">{platformDisplayName(platform.id, platform.name)}</span>
                {isHidden ? (
                  <EyeOff className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 flex-shrink-0 text-foreground" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 pb-8">
        <h2 className="mb-4 text-lg font-semibold tracking-tight">{t('设置')}</h2>

        <div className="space-y-6">
          <Section title={t('连接')}>
            <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
              {bridgeStatus.connected ? (
                <PlugZap className="h-5 w-5 flex-shrink-0 text-emerald-500" />
              ) : (
                <Plug className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('DSwritesync 本地服务')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{connectionStatus}</p>
                {bridgeStatus.lastError && (
                  <p className="mt-1 text-xs text-destructive">{t(bridgeStatus.lastError)}</p>
                )}
              </div>
              <Switch checked={bridgeStatus.enabled} onChange={toggleBridge} />
            </div>

            <div className="space-y-3 px-4 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {serveHintBefore}
                <code className="rounded bg-muted/60 px-1 py-0.5 text-[11px]">{SERVE_COMMAND}</code>
                {serveHintAfter}
              </p>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">{t('桥接 Token')}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {bridgeStatus.hasToken
                      ? t('已保存 · 尾号 {tail}', { tail: bridgeStatus.tokenTail || '****' })
                      : t('未设置')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={event => {
                      setTokenInput(event.target.value)
                      if (tokenNotice?.tone === 'error') setTokenNotice(null)
                    }}
                    placeholder={bridgeStatus.hasToken ? t('粘贴新 Token 以替换') : t('粘贴工作台显示的 Token')}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs outline-none transition-colors focus:border-foreground"
                  />
                  <button
                    type="button"
                    onClick={saveToken}
                    disabled={tokenBusy || !tokenInput.trim()}
                    className="h-10 flex-shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
                  >
                    {tokenBusy ? t('保存中…') : t('保存')}
                  </button>
                  <button
                    type="button"
                    onClick={clearToken}
                    disabled={tokenBusy || !bridgeStatus.hasToken}
                    className="h-10 flex-shrink-0 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-muted/50 disabled:opacity-40"
                  >
                    {t('清除')}
                  </button>
                </div>
                {tokenNotice && (
                  <p className={cn(
                    'mt-1.5 text-xs',
                    tokenNotice.tone === 'error' ? 'text-destructive' : 'text-emerald-600'
                  )}>
                    {t(tokenNotice.text)}
                  </p>
                )}
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{t('服务地址')}</span>
                <input
                  type="text"
                  value={serverUrlInput}
                  onChange={event => handleServerUrlChange(event.target.value)}
                  placeholder="ws://127.0.0.1:9527"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-xs outline-none transition-colors focus:border-foreground"
                />
              </label>

              <button
                type="button"
                onClick={copyServeCommand}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium transition-colors hover:bg-muted/50"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t('已复制') : t('复制 dswritesync serve')}
              </button>
            </div>
          </Section>

          <Section title={t('通用')}>
            <div className="px-4 py-3">
              <p className="mb-2 text-sm font-medium">{t('语言')}</p>
              <div className="flex rounded-lg bg-muted p-0.5">
                {LANGUAGE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPreference(option.value)}
                    aria-pressed={preference === option.value}
                    className={cn(
                      'flex h-8 flex-1 items-center justify-center rounded-md text-xs font-medium transition-colors',
                      preference === option.value
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t(option.label)}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title={t('同步设置')}>
            <button
              type="button"
              onClick={() => setView('platforms')}
              disabled={allPlatforms.length === 0}
              className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-60"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('常用平台')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {allPlatforms.length > 0
                    ? t('隐藏不常用的平台 · {shown}/{total} 个显示', {
                        shown: shownCount,
                        total: allPlatforms.length,
                      })
                    : t('加载平台列表中…')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </button>

            <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('深度格式清理')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('同步前通过 Markdown 清理格式，可能损失部分排版')}
                </p>
              </div>
              <Switch checked={deepCleanEnabled} onChange={toggleDeepClean} />
            </div>
          </Section>

          <Section title={t('网页功能')}>
            <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('悬浮同步按钮')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('在网页右下角显示快捷同步按钮')}
                </p>
              </div>
              <Switch checked={floatingButtonEnabled} onChange={toggleFloatingButton} />
            </div>
          </Section>

          <Section title={t('自建站点')}>
            <button
              type="button"
              onClick={() => navigate('/accounts')}
              className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('CMS 账号')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {cmsAccountCount > 0
                    ? t('{count} 个站点 · WordPress / Typecho / MetaWeblog', { count: cmsAccountCount })
                    : t('添加 WordPress / Typecho / MetaWeblog')}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </button>
          </Section>

          <Section title={t('关于')}>
            <div className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-sm">{t('版本')}</span>
              <span className="text-xs text-muted-foreground">
                v{chrome.runtime.getManifest().version}
              </span>
            </div>
            <div className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-sm">{t('许可')}</span>
              <span className="text-xs text-muted-foreground">GPL-3.0</span>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('基于 Wechatsync 2.0.10（GPL-3.0）构建。视觉参考 StashDock（AGPL-3.0），未复制其代码。')}
              </p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}