// 设置：界面语言、导出位置、桥接(浏览器扩展)与迁移。写作与生图都发生在创作会话侧(ADR 0006)。
import React from 'react'
import { fetchBridgeStatus, migrateMediaDesk, previewMediaDesk, report, saveSettings, setDesk, toast, useDesk } from './desk.js'
import { t, useLang } from './i18n.js'
import { updateUrl, useVersionInfo } from './version.js'
import { Dialog } from './ui.jsx'

// 中文和 English 各用自己的语言写，切错了也认得出来
const LANGUAGES = [
  { value: 'auto', label: () => t('跟随 DeepSeek Harness') },
  { value: 'zh', label: () => '中文' },
  { value: 'en', label: () => 'English' },
]

export function SettingsDialog() {
  useLang()
  const open = useDesk(s => s.settingsOpen)
  const settings = useDesk(s => s.settings)
  const [form, setForm] = React.useState(null)
  const [migration, setMigration] = React.useState(null)
  const [migrating, setMigrating] = React.useState(false)
  const [bridge, setBridge] = React.useState(null)
  const version = useVersionInfo()
  React.useEffect(() => {
    if (!open || !settings) return
    setForm({ language: settings.language ?? 'auto', exportDir: settings.exportDir ?? '' })
  }, [open, settings])
  React.useEffect(() => {
    if (!open) { setMigration(null); setBridge(null); return }
    let alive = true
    previewMediaDesk().then(data => { if (alive) setMigration(data) }).catch(err => { if (alive) setMigration({ found: false, error: err.message }) })
    fetchBridgeStatus().then(data => { if (alive) setBridge(data) }).catch(() => {})
    return () => { alive = false }
  }, [open])
  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(bridge.token)
      toast(t('桥接 Token 已复制'))
    } catch (err) {
      report(err)
    }
  }
  if (!open || !form) return null
  const close = () => setDesk({ settingsOpen: false })
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  return (
    <Dialog title={t('设置')} onClose={close} width={520}>
      <form className="md-form" onSubmit={async (event) => {
        event.preventDefault()
        if (await saveSettings({ language: form.language, exportDir: form.exportDir })) close()
      }}>
        <div className="md-field">
          <span>{t('语言')}</span>
          <div className="md-presets" role="radiogroup" aria-label={t('语言')}>
            {LANGUAGES.map(option => (
              <button type="button" key={option.value} role="radio" aria-checked={form.language === option.value} className={form.language === option.value ? 'is-on' : ''} onClick={() => set('language', option.value)}>{option.label()}</button>
            ))}
          </div>
        </div>
        <label className="md-field">
          <span>{t('成稿保存到')}</span>
          <input value={form.exportDir} onChange={e => set('exportDir', e.target.value)} placeholder={settings.defaultExportDir} />
        </label>
        <div className="md-field">
          <span>{t('从自媒体工作台迁移')}</span>
          <p className="md-migrate-hint">{t('把自媒体工作台里的灵感、排期和媒体文件搬过来，按名字合并角度与读者。')}</p>
          {migration === null ? <p className="md-migrate-hint">{t('正在检查…')}</p> : !migration.found ? (
            <p className="md-migrate-hint">{migration.error ? migration.error : t('没有找到自媒体工作台的数据。')}</p>
          ) : (
            <div className="md-migrate">
              <div className="md-migrate-counts">{t('{n} 条灵感 · {m} 个媒体 · {k} 条排期', { n: migration.total, m: migration.media, k: migration.scheduled })}</div>
              {migration.samples ? <div className="md-migrate-hint">{t('其中 {n} 条是示例数据。', { n: migration.samples })}</div> : null}
              {migration.migratedAt ? <div className="md-migrate-hint">{t('上次迁移：{time}', { time: new Date(migration.migratedAt).toLocaleString() })}</div> : null}
              <div className="md-migrate-actions">
                <button type="button" className="md-btn is-primary is-mini" disabled={migrating} onClick={async () => {
                  setMigrating(true)
                  try {
                    const result = await migrateMediaDesk()
                    setMigration(await previewMediaDesk())
                    toast(result.missingMedia
                      ? t('已迁移 {n} 条灵感，{m} 个媒体文件没找到', { n: result.added, m: result.missingMedia })
                      : t('已迁移 {n} 条灵感', { n: result.added }))
                  } catch (err) { report(err) } finally { setMigrating(false) }
                }}>{migration.migratedAt ? t('再迁移一次') : t('迁移过来')}</button>
                <span className="md-migrate-hint">{t('不满意可以撤销')}</span>
              </div>
            </div>
          )}
        </div>
        <div className="md-field">
          <span>{t('浏览器扩展(网页收发)')}</span>
          <p className="md-migrate-hint">{t('装上「图文创作台 · 网页收发」扩展后,在任意网页一键收藏进灵感墙;成稿可一键投递到公众号、知乎、掘金的草稿箱。')}</p>
          {bridge === null ? null : bridge.configured ? (
            <div className="md-migrate">
              <div className="md-bridge-row">
                <code className="md-bridge-token">{bridge.token.slice(0, 4)}…{bridge.token.slice(-4)}</code>
                <button type="button" className="md-btn is-small" onClick={copyToken}>{t('复制 Token')}</button>
              </div>
              <div className="md-migrate-hint">
                {bridge.pending.inbox + bridge.pending.outbox + bridge.pending.receipts
                  ? t('投递箱里还有 {n} 件没消化,起一次桥或等宿主下一轮处理', { n: bridge.pending.inbox + bridge.pending.outbox + bridge.pending.receipts })
                  : t('桥已配置。终端跑 wdesk serve 起桥,扩展即连。')}
              </div>
            </div>
          ) : (
            <p className="md-migrate-hint">{t('还没配过桥:终端跑一次 wdesk serve,Token 会生成在这里,粘进扩展设置即连。')}</p>
          )}
        </div>
        <div className="md-version">
          <span>{t('版本')} {version?.current ? `v${version.current}` : '—'}</span>
          {version?.updateAvailable ? <a href={updateUrl(version)} target="_blank" rel="noreferrer">{t('有新版本 ↑ v{version}', { version: version.latest })}</a> : null}
        </div>
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary">{t('保存')}</button>
        </div>
      </form>
    </Dialog>
  )
}
