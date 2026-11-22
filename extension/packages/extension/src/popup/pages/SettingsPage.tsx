import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronRight,
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
  paired: boolean
  connected: boolean
  dshActive: boolean
  lastError: string | null
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
    </section>
  )
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      // 18px 控件纪律(ADR 0010):全高黑药丸太重,收窄轨道与滑块的比例
      className={cn(
        'relative h-5 w-9 flex-shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] h-3.5 w-3.5 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-[18px] bg-primary-foreground' : 'translate-x-[2px] bg-white'
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
  const { t, preference, setPreference } = useI18n()
  const [view, setView] = useState<'main' | 'platforms'>('main')
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({
    paired: false,
    connected: false,
    dshActive: false,
    lastError: null,
  })
  const [floatingButtonEnabled, setFloatingButtonEnabled] = useState(false)
  const [deepCleanEnabled, setDeepCleanEnabled] = useState(false)
  const [allPlatforms, setAllPlatforms] = useState<PlatformInfo[]>([])
  const [hiddenPlatforms, setHiddenPlatforms] = useState<Set<string>>(new Set())

  const applyBridgeStatus = (response: any) => {
    if (!response || response.error) return
    setBridgeStatus({
      paired: response.paired ?? false,
      connected: response.connected ?? false,
      dshActive: response.dshActive ?? false,
      lastError: response.lastError ?? null,
    })
  }

  const refreshBridgeStatus = () => {
    chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' }, applyBridgeStatus)
  }

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' }, response => {
      if (response && !response.error) applyBridgeStatus(response)
    })

    chrome.storage.local.get(
      ['floatingButtonEnabled', 'deepCleanEnabled', HIDDEN_PLATFORMS_KEY],
      result => {
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
  }, [])

  // 设置页打开期间开长端口并轮询状态;离开时归还引用计数
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'BRIDGE_WATCH_START' })
    const interval = setInterval(refreshBridgeStatus, 3000)

    return () => {
      clearInterval(interval)
      chrome.runtime.sendMessage({ type: 'BRIDGE_WATCH_STOP' })
    }
  }, [])

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

  const connectionStatus = !bridgeStatus.paired
    ? t('未配对')
    : bridgeStatus.connected
      ? t('已连接')
      : t('连接中')

  if (view === 'platforms') {
    return (
      <div className="flex h-full flex-col">
        <header className="flex flex-none items-center gap-2 border-b border-border/70 px-4 py-3">
          <button
            onClick={() => setView('main')}
            aria-label={t('返回设置')}
            className="-ml-1 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4"  strokeWidth={1.6} />
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
                  <EyeOff className="h-4 w-4 flex-shrink-0 text-muted-foreground"  strokeWidth={1.6} />
                ) : (
                  <Eye className="h-4 w-4 flex-shrink-0 text-foreground"  strokeWidth={1.6} />
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
              {bridgeStatus.paired ? (
                <PlugZap className="h-5 w-5 flex-shrink-0 text-status-published"  strokeWidth={1.6} />
              ) : (
                <Plug className="h-5 w-5 flex-shrink-0 text-muted-foreground"  strokeWidth={1.6} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('DSwritesync 本地助手')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{connectionStatus}</p>
                {bridgeStatus.lastError && (
                  <p className="mt-1 text-xs text-destructive">{t(bridgeStatus.lastError)}</p>
                )}
              </div>
            </div>

            <div className="space-y-2 px-4 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('扩展与图文创作台经浏览器 Native Messaging 直连：装好两边即自动配对，无需 token 或端口配置。')}
              </p>
              {!bridgeStatus.paired && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t('未配对时：重启一次 DeepSeek Harness（启动即自动注册修复），确认本机装有 Node.js，然后回到本页查看状态。')}
                </p>
              )}
              {bridgeStatus.paired && !bridgeStatus.dshActive && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t('图文创作台没在运行:现在收录的网页会在它下次启动后出现在灵感墙。')}
                </p>
              )}
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
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground"  strokeWidth={1.6} />
            </button>

            <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('深度格式清理')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('同步前通过 Markdown 清理格式，可能损失部分排版')}
                </p>
              </div>
              <Switch checked={deepCleanEnabled} label={t('深度格式清理')} onChange={toggleDeepClean} />
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
              <Switch checked={floatingButtonEnabled} label={t('悬浮同步按钮')} onChange={toggleFloatingButton} />
            </div>
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
          </Section>
        </div>
      </div>
    </div>
  )
}