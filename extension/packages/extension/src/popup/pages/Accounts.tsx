import { useState, useEffect } from 'react'
import { ArrowLeft, Globe, Loader2, Plus, Trash2, Check, ChevronRight } from 'lucide-react'
import { platformDisplayName } from '@/lib/platform-names'
import { translateAdapterError } from '@/lib/i18n'
import { Button } from '../components/ui/Button'
import { useCMSStore, type CMSType } from '../stores/cms'
import { useI18n } from '../LocaleProvider'
interface PlatformStatus {
  id: string
  name: string
  icon: string
  homepage: string
  isAuthenticated: boolean
  username?: string
}

interface CMSAccount {
  id: string
  name: string
  type: string
  url: string
}

const cmsOptions: { id: CMSType; name: string; description: string; icon?: string }[] = [
  { id: 'wordpress', name: 'WordPress', description: '支持 XML-RPC 或 REST API', icon: 'https://s.w.org/style/images/about/WordPress-logotype-simplified.png' },
  { id: 'typecho', name: 'Typecho', description: '支持 XML-RPC 接口', icon: '/assets/typecho.ico' },
  // metaweblog 是协议不是品牌,不冒用博客园 favicon,用中性 Globe
  { id: 'metaweblog', name: 'MetaWeblog API', description: '通用博客接口协议（博客园等）' },
]

// ── Shared sub-page header ──
function PageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b">
      <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
        <ArrowLeft className="w-4 h-4"  strokeWidth={1.6} />
      </button>
      <h1 className="font-semibold">{title}</h1>
    </header>
  )
}

// ── Platform row ──
function PlatformRow({ platform, isLast }: { platform: PlatformStatus; isLast: boolean }) {
  const { t } = useI18n()
  const name = platformDisplayName(platform.id, platform.name)
  return (
    <>
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 transition-colors cursor-pointer hover:bg-muted/50"
        onClick={() => platform.homepage && chrome.tabs.create({ url: platform.homepage })}
      >
        <img
          src={platform.icon}
          alt={name}
          className="w-5 h-5 rounded flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).src = '/assets/icon-48.png' }}
        />
        <span className="text-sm flex-1 truncate">{name}</span>
        {platform.isAuthenticated ? (
          <span className="text-xs text-status-published truncate max-w-[80px] flex-shrink-0">
            {platform.username || t('已登录')}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground flex items-center gap-0.5 flex-shrink-0">
            {t('去登录')} <ChevronRight className="w-3 h-3"  strokeWidth={1.6} />
          </span>
        )}
      </div>
      {!isLast && <div className="mx-4 border-b border-border/40" />}
    </>
  )
}

export function AccountsPage() {
  const { t } = useI18n()
  const { addAccount } = useCMSStore()

  const [platforms, setPlatforms] = useState<PlatformStatus[]>([])
  const [platformsLoading, setPlatformsLoading] = useState(true)
  const [platformsError, setPlatformsError] = useState('')
  const [cmsAccounts, setCmsAccounts] = useState<CMSAccount[]>([])

  // CMS form state
  const [step, setStep] = useState<'list' | 'add-cms-select' | 'add-cms-config'>('list')
  const [selectedCMS, setSelectedCMS] = useState<CMSType | null>(null)
  const [config, setConfig] = useState({ url: '', username: '', password: '', name: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 删除自建站点(连密码一起删)走两步确认:点垃圾桶进入确认态,防误触即永久丢失
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const mapPlatforms = (list: any[]): PlatformStatus[] =>
    list
      // CMS 站点只在「自建站点」区展示，避免重复出现且删除后残留
      .filter((p: any) => p.sourceType !== 'cms')
      .map((p: any) => ({
        id: p.id, name: p.name, icon: p.icon,
        homepage: p.homepage, isAuthenticated: p.isAuthenticated,
        username: p.username,
      }))

  const loadPlatforms = () => {
    setPlatformsError('')
    ;(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH', payload: { forceRefresh: false } })
        if (response?.platforms) {
          setPlatforms(mapPlatforms(response.platforms))
        } else if (response?.error) {
          // background 把异常包成 { error } 返回，永远 resolve
          setPlatformsError(response.error)
        }
        setPlatformsLoading(false)
      } catch (e: any) {
        setPlatformsError(e?.message || '加载失败')
        setPlatformsLoading(false)
      }
    })()
  }

  useEffect(() => {
    // Cache first, then live refresh（缓存回调不覆盖已到达的新回包）
    chrome.storage.local.get(['platformListCache', 'cmsAccounts'], (result) => {
      if (result.platformListCache?.length) {
        setPlatforms(prev => prev.length ? prev : mapPlatforms(result.platformListCache))
        setPlatformsLoading(false)
      }
      setCmsAccounts(result.cmsAccounts || [])
    })

    loadPlatforms()
  }, [])

  const deleteCmsAccount = async (id: string) => {
    const storage = await chrome.storage.local.get('cmsAccounts')
    const updated = (storage.cmsAccounts || []).filter((a: CMSAccount) => a.id !== id)
    await chrome.storage.local.set({ cmsAccounts: updated })
    await chrome.storage.local.remove(`cms_pwd_${id}`)
    setCmsAccounts(updated)
  }

  const handleSubmitCMS = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await addAccount({ type: selectedCMS!, name: config.name, url: config.url, username: config.username, password: config.password })
      if (result.success) {
        const storage = await chrome.storage.local.get('cmsAccounts')
        setCmsAccounts(storage.cmsAccounts || [])
        setStep('list')
        setConfig({ url: '', username: '', password: '', name: '' })
        setSelectedCMS(null)
      } else {
        setError(result.error || '添加失败')
      }
    } catch (err) {
      setError((err as Error).message)
    }
    setLoading(false)
  }

  const authed = platforms.filter(p => p.isAuthenticated)
  const unauthed = platforms.filter(p => !p.isAuthenticated)

  // ── CMS config form ──
  if (step === 'add-cms-config' && selectedCMS) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          title={t('配置 {name}', { name: cmsOptions.find(c => c.id === selectedCMS)?.name ?? '' })}
          onBack={() => setStep('add-cms-select')}
        />
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-muted-foreground mb-4">{t('输入站点信息以连接')}</p>
          <form onSubmit={handleSubmitCMS} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('站点名称')}</label>
              <input type="text" value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} placeholder={t('我的博客')} className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('站点地址')}</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"  strokeWidth={1.6} />
                <input type="url" value={config.url} onChange={e => setConfig({ ...config, url: e.target.value })} placeholder="https://example.com" className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('用户名')}</label>
              <input type="text" value={config.username} onChange={e => setConfig({ ...config, username: e.target.value })} placeholder="admin" className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('密码')}</label>
              <input type="password" value={config.password} onChange={e => setConfig({ ...config, password: e.target.value })} placeholder="••••••••" className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" required />
              <p className="text-xs text-muted-foreground mt-1">{t('密码仅存储在本地，不会上传到任何服务器')}</p>
            </div>
            {error && <div className="text-sm text-status-danger bg-status-danger/10 p-2.5 rounded-lg">{translateAdapterError(error)}</div>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? t('连接中...') : t('添加站点')}</Button>
          </form>
        </div>
      </div>
    )
  }

  // ── CMS type selection ──
  if (step === 'add-cms-select') {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title={t('添加自建站点')} onBack={() => setStep('list')} />
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-muted-foreground mb-3">{t('选择博客系统类型')}</p>
          <div className="space-y-2">
            {cmsOptions.map(cms => (
              <button
                key={cms.id}
                onClick={() => { setSelectedCMS(cms.id); setStep('add-cms-config') }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary transition-colors text-left"
              >
                {cms.icon ? (
                  <img src={cms.icon} alt={cms.name} className="w-8 h-8 rounded" onError={e => { (e.target as HTMLImageElement).src = '/assets/icon-48.png' }} />
                ) : (
                  <span className="w-8 h-8 rounded flex items-center justify-center bg-muted flex-shrink-0">
                    <Globe className="w-4 h-4 text-muted-foreground"  strokeWidth={1.6} />
                  </span>
                )}
                <div className="flex-1">
                  <div className="font-medium text-sm">{cms.name}</div>
                  <div className="text-xs text-muted-foreground">{t(cms.description)}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0"  strokeWidth={1.6} />
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Main list ──
  return (
    <div className="flex flex-col h-full">
      {/* tab 高亮已标明位置,不再重复页标题;计数是本页唯一的头部信息 */}
      <header className="flex flex-shrink-0 items-center px-4 pb-1 pt-3">
        {!platformsLoading && (
          <span className="text-xs text-muted-foreground">
            {t('{authed}/{total} 已登录', { authed: authed.length, total: platforms.length })}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {platformsLoading && platforms.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground"  strokeWidth={1.6} />
          </div>
        )}

        {/* Load error */}
        {!platformsLoading && platformsError && platforms.length === 0 && (
          <div className="text-center py-10">
            <p className="text-xs text-muted-foreground">{t('平台状态加载失败')}</p>
            <button
              onClick={() => { setPlatformsLoading(true); loadPlatforms() }}
              className="mt-2 text-xs text-primary hover:underline"
            >
              {t('重试')}
            </button>
          </div>
        )}

        {/* Authenticated platforms */}
        {authed.length > 0 && (
          <div className="pt-2 pb-1">
            <h3 className="text-xs font-medium text-muted-foreground px-4 mb-1">{t('已登录')}</h3>
            {authed.map((p, i) => <PlatformRow key={p.id} platform={p} isLast={i === authed.length - 1} />)}
          </div>
        )}

        {/* Unauthenticated platforms */}
        {unauthed.length > 0 && (
          <div className="pt-3 pb-1">
            <h3 className="text-xs font-medium text-muted-foreground px-4 mb-1">{t('未登录')}</h3>
            {unauthed.map((p, i) => <PlatformRow key={p.id} platform={p} isLast={i === unauthed.length - 1} />)}
          </div>
        )}

        {/* Divider */}
        {platforms.length > 0 && <div className="mx-4 my-1 border-t" />}

        {/* CMS accounts:平台状态未定时不同时渲染空态,避免「转圈 + 暂无」同屏 */}
        {!platformsLoading && (
          <div className="px-4 pt-2 pb-4">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{t('自建站点')}</h3>
              <button
                onClick={() => setStep('add-cms-select')}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="w-3 h-3"  strokeWidth={1.6} />
                {t('添加')}
              </button>
            </div>

            {cmsAccounts.length === 0 ? (
              <p className="py-5 text-center text-xs text-muted-foreground">{t('暂无自建站点')}</p>
            ) : (
              <div className="space-y-1.5">
                {cmsAccounts.map(account => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card"
                  >
                    <span className="w-5 h-5 rounded-full bg-status-published/10 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-status-published"  strokeWidth={1.6} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{account.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{account.url}</p>
                    </div>
                    {confirmingDelete === account.id ? (
                      <span className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => { void deleteCmsAccount(account.id); setConfirmingDelete(null) }}
                          className="rounded-md px-2 py-1 text-xs font-medium text-status-danger hover:bg-status-danger/10"
                        >
                          {t('删除')}
                        </button>
                        <button
                          onClick={() => setConfirmingDelete(null)}
                          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                        >
                          {t('取消')}
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmingDelete(account.id)}
                        aria-label={t('删除')}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5"  strokeWidth={1.6} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
