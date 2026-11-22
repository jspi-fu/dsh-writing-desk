// 设置：界面语言、导出位置、桥接(浏览器扩展)与迁移。写作与生图都发生在创作会话侧(ADR 0006)。
import React from 'react'
import { fetchBridgeStatus, migrateMediaDesk, pickFolder, previewMediaDesk, report, saveSettings, setDesk, toast, useDesk } from './desk.js'
import { t, useLang } from './i18n.js'
import { updateUrl, useVersionInfo } from './version.js'
import { Dialog, Icon } from './ui.jsx'

// 中文和 English 各用自己的语言写，切错了也认得出来
const LANGUAGES = [
  { value: 'auto', label: () => t('跟随 DeepSeek Harness') },
  { value: 'zh', label: () => '中文' },
  { value: 'en', label: () => 'English' },
]

const EMPTY_SELECTION = { items: true, schedule: true, taxonomy: true, styles: true }

function BridgeRow({ bridge, onRefresh }) {
  const [guide, setGuide] = React.useState(false)
  const pending = bridge ? bridge.pending.inbox + bridge.pending.outbox + bridge.pending.receipts : 0
  return (
    <div className="md-integration">
      <div className="md-integration-row">
        <span className="md-integration-icon"><Icon name="link" size={15} /></span>
        <div className="md-integration-main">
          <strong>DSwritesync</strong>
          <small>{bridge === null ? t('正在检查连接…') : bridge.paired ? t('{n} 个浏览器已注册', { n: bridge.browsers.length }) : t('浏览器扩展')}</small>
        </div>
        <span className={`md-integration-state ${bridge?.paired ? 'is-ok' : ''}`}>
          <i />{bridge === null ? '…' : bridge.paired ? t('已配对') : t('未配对')}
        </span>
        <button type="button" className="md-icon-btn" onClick={onRefresh} aria-label={t('刷新连接状态')} title={t('刷新连接状态')}>
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <div className="md-integration-foot">
        <button type="button" className="md-link-btn" onClick={() => setGuide(v => !v)}>
          {guide ? t('收起说明') : t('查看连接说明')}
          <Icon name={guide ? 'chevD' : 'chevR'} size={12} />
        </button>
        {pending ? <span className="md-integration-note">{t('投递箱还有 {n} 件', { n: pending })}</span> : null}
      </div>
      {guide ? (
        <div className="md-integration-guide">
          <p>{t('装好扩展与工作台，两边会自动配对；收进和投递都不经过模型。')}</p>
          <p>{bridge && !bridge.paired ? t('没配对时，重启 DeepSeek Harness 会自动修复注册；再确认本机装有 Node.js。') : t('DSH 没开着时收进的内容，会在下次启动后出现在灵感墙。')}</p>
        </div>
      ) : null}
    </div>
  )
}

function MigrationStep({ migration, onBack, onDone }) {
  const [selection, setSelection] = React.useState(EMPTY_SELECTION)
  const [migrating, setMigrating] = React.useState(false)
  const toggle = (key) => setSelection(s => {
    const next = { ...s, [key]: !s[key] }
    // 角度和读者合并成一组勾选，服务端仍按两个字段接收
    if (key === 'taxonomy') { next.angles = next.taxonomy; next.people = next.taxonomy }
    if (next.items === false) next.schedule = false
    return next
  })
  const any = selection.items || selection.schedule || selection.taxonomy || selection.styles
  const submit = async () => {
    if (!any) return
    setMigrating(true)
    try {
      const result = await migrateMediaDesk({
        items: selection.items,
        schedule: selection.schedule,
        angles: selection.taxonomy,
        people: selection.taxonomy,
        styles: selection.styles,
      })
      toast(result.added
        ? (result.missingMedia
          ? t('已迁移 {n} 条灵感，{m} 个媒体文件没找到', { n: result.added, m: result.missingMedia })
          : t('已迁移 {n} 条灵感', { n: result.added }))
        : t('迁移完成'))
      onDone()
    } catch (err) {
      report(err)
    } finally {
      setMigrating(false)
    }
  }
  return (
    <div className="md-migrate-step">
      <p className="md-field-hint">{t('旧工作台的数据会被复制，不会删除原文件。只勾选你现在想搬过来的部分。')}</p>
      <div className="md-migrate-groups">
        <label className={`md-migrate-row ${selection.items ? 'is-on' : ''}`}>
          <input type="checkbox" checked={selection.items} onChange={() => toggle('items')} />
          <span><strong>{t('灵感和媒体文件')}</strong><small>{t('{n} 条灵感 · {m} 个媒体', { n: migration.total, m: migration.media })}</small></span>
        </label>
        <label className={`md-migrate-row ${selection.schedule ? 'is-on' : ''}`}>
          <input type="checkbox" checked={selection.schedule} disabled={!selection.items} onChange={() => toggle('schedule')} />
          <span><strong>{t('排期与发布状态')}</strong><small>{t('{n} 条排期 · {p} 条已发布', { n: migration.scheduled, p: migration.published })}</small></span>
        </label>
        <label className={`md-migrate-row ${selection.taxonomy ? 'is-on' : ''}`}>
          <input type="checkbox" checked={selection.taxonomy} onChange={() => toggle('taxonomy')} />
          <span><strong>{t('角度与读者')}</strong><small>{t('{a} 个角度 · {p} 位读者', { a: migration.angles, p: migration.people })}</small></span>
        </label>
        <label className={`md-migrate-row ${selection.styles ? 'is-on' : ''}`}>
          <input type="checkbox" checked={selection.styles} onChange={() => toggle('styles')} />
          <span><strong>{t('风格')}</strong><small>{t('{n} 张风格卡', { n: migration.styles })}</small></span>
        </label>
      </div>
      <div className="md-migrate-meta">
        {migration.samples ? <span>{t('其中 {n} 条是示例数据', { n: migration.samples })}</span> : null}
        {migration.migratedAt ? <span>{t('上次迁移：{time}', { time: new Date(migration.migratedAt).toLocaleString() })}</span> : null}
      </div>
      <div className="md-form-foot">
        <button type="button" className="md-btn" onClick={onBack}>{t('取消')}</button>
        <button type="button" className="md-btn is-primary" disabled={!any || migrating} onClick={submit}>
          {migrating ? t('正在迁移…') : t('继续迁移')}
        </button>
      </div>
    </div>
  )
}

export function SettingsDialog() {
  useLang()
  const open = useDesk(s => s.settingsOpen)
  const settings = useDesk(s => s.settings)
  const [form, setForm] = React.useState(null)
  const [migration, setMigration] = React.useState(null)
  const [migrationStep, setMigrationStep] = React.useState(false)
  const [checking, setChecking] = React.useState(false)
  const [picking, setPicking] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [bridge, setBridge] = React.useState(null)
  const version = useVersionInfo()
  React.useEffect(() => {
    if (!open || !settings) return
    setForm({ language: settings.language ?? 'auto', exportDir: settings.exportDir ?? '' })
  }, [open, settings])
  React.useEffect(() => {
    if (!open) {
      setMigration(null)
      setMigrationStep(false)
      setChecking(false)
      setPicking(false)
      setNote('')
      setBridge(null)
      return
    }
    let alive = true
    fetchBridgeStatus().then(data => { if (alive) setBridge(data) }).catch(() => {})
    return () => { alive = false }
  }, [open])
  if (!open || !form) return null
  const close = () => setDesk({ settingsOpen: false })
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const refreshBridge = () => { fetchBridgeStatus().then(setBridge).catch(() => {}) }
  const startMigration = async () => {
    setChecking(true)
    setNote('')
    try {
      const data = await previewMediaDesk()
      setMigration(data)
      if (data.found) setMigrationStep(true)
      else setNote(data.error ? data.error : t('没有找到自媒体工作台的数据。'))
    } catch (err) {
      setNote(err.message)
    } finally {
      setChecking(false)
    }
  }
  const chooseFolder = async () => {
    setPicking(true)
    try {
      const data = await pickFolder(form.exportDir || settings.defaultExportDir)
      if (data?.path) set('exportDir', data.path)
    } finally {
      setPicking(false)
    }
  }
  return (
    <Dialog title={migrationStep ? t('迁移数据') : t('设置')} onClose={close} width={520}>
      {migrationStep && migration ? (
        <MigrationStep
          migration={migration}
          onBack={() => setMigrationStep(false)}
          onDone={close}
        />
      ) : (
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
          <div className="md-field">
            <span>{t('成稿保存到')}</span>
            <div className="md-path-line">
              <input value={form.exportDir} onChange={e => set('exportDir', e.target.value)} placeholder={settings.defaultExportDir} />
              <button type="button" className="md-btn is-mini" disabled={picking} onClick={chooseFolder}>
                <Icon name="folder" size={13} />{picking ? t('正在选择…') : t('选择文件夹')}
              </button>
            </div>
            <p className="md-field-hint">{t('作品第一次保存时会让你确认文件夹，之后直接写回同一处。')}</p>
          </div>
          <div className="md-field">
            <span>{t('从自媒体工作台迁移')}</span>
            <p className="md-field-hint">{t('先识别旧数据，再选择要复制哪几组；原工作台不会被改动。')}</p>
            {note ? <p className="md-field-hint is-warn">{note}</p> : null}
            <div className="md-migrate-actions">
              <button type="button" className="md-btn is-mini" disabled={checking} onClick={startMigration}>
                {checking ? t('正在识别…') : t('开始迁移')}
              </button>
              {migration?.migratedAt ? <span className="md-field-hint">{t('上次迁移：{time}', { time: new Date(migration.migratedAt).toLocaleString() })}</span> : null}
            </div>
          </div>
          <div className="md-field">
            <span>{t('浏览器扩展')}</span>
            <BridgeRow bridge={bridge} onRefresh={refreshBridge} />
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
      )}
    </Dialog>
  )
}
