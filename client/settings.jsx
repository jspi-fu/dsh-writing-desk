// 设置：界面语言与导出位置。写作与生图都发生在创作会话侧(ADR 0006),插件不再有模型配置。
import React from 'react'
import { saveSettings, setDesk, useDesk } from './desk.js'
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
  const version = useVersionInfo()
  React.useEffect(() => {
    if (!open || !settings) return
    setForm({ language: settings.language ?? 'auto', exportDir: settings.exportDir ?? '' })
  }, [open, settings])
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
