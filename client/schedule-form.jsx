// 排期只做一件事：到点在应用里提醒（ADR 0013 修订）。
// 它是编辑弹层标题行右侧的一枚小按钮：日历图标 + 已排时间/未排期；点开就地展开
// 时间、系统提示和取消排期，没有平台、没有自动成稿/自动发布，也不叠二级弹层。
// 胶囊成员的排期属于整张胶囊，所以这里只说明「整张胶囊一起排期」；保存仍走
// schedule_item，由 Host 把时间与提醒开关同步给胶囊的全部成员。
import React from 'react'
import { dispatchOps, EMPTY_LIST, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'
import { fmtWhen, toLocalInput } from './util.js'

/** 没排过期时默认填今晚 20:00，和排期页把卡片拖进日历同一口径。 */
function defaultAt() {
  const next = new Date()
  next.setHours(20, 0, 0, 0)
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
  return toLocalInput(next.toISOString())
}

export function ScheduleBox({ item }) {
  const capsules = useDesk(state => state.state?.capsules ?? EMPTY_LIST)
  const capsule = capsules.find(row => (row.itemIds ?? []).includes(item.id))
  const [open, setOpen] = React.useState(false)
  const [at, setAt] = React.useState('')
  const [reminder, setReminder] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  // 每次展开都从这条灵感现在的值重新铺一遍，避免上次没保存的草稿留在面板里
  const expand = () => {
    if (open) {
      setOpen(false)
      return
    }
    setAt(toLocalInput(item.scheduledAt) || defaultAt())
    setReminder(item.reminder !== false)
    setOpen(true)
  }

  const save = async () => {
    if (busy || !at) return
    const date = new Date(at)
    if (Number.isNaN(date.getTime())) return
    setBusy(true)
    await dispatchOps([{ op: 'schedule_item', id: item.id, scheduledAt: date.toISOString(), reminder, platform: null }], { label: t('排期') })
    setBusy(false)
    setOpen(false)
  }

  const unschedule = async () => {
    if (busy) return
    setBusy(true)
    await dispatchOps([{ op: 'schedule_item', id: item.id, scheduledAt: null }], { label: t('取消排期') })
    setBusy(false)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        className={`md-schedule-inline ${item.scheduledAt ? 'is-set' : ''} ${open ? 'is-open' : ''}`}
        aria-expanded={open}
        title={item.scheduledAt ? t('排期：{when}', { when: fmtWhen(item.scheduledAt) }) : t('设置排期提醒')}
        onClick={expand}
      >
        <Icon name="calendar" size={13} />
        <span>{fmtWhen(item.scheduledAt)}</span>
      </button>
      {open ? (
        <div className="md-schedule-panel">
          {capsule ? <p className="md-schedulebox-hint">{t('这张灵感属于胶囊「{name}」：整张胶囊一起排期。', { name: capsule.name })}</p> : null}
          <label className="md-field">
            <span>{t('提醒时间')}</span>
            <input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} />
          </label>
          <label className="md-check">
            <input type="checkbox" checked={reminder} onChange={event => setReminder(event.target.checked)} />
            <span>{t('系统提示（到点在应用里提醒，手动关掉）')}</span>
          </label>
          <div className="md-schedulebox-foot">
            {item.scheduledAt ? <button type="button" className="md-btn is-danger" disabled={busy} onClick={unschedule}>{t('取消排期')}</button> : null}
            <span style={{ flex: 1 }} />
            <button type="button" className="md-btn" onClick={() => setOpen(false)}>{t('收起')}</button>
            <button type="button" className="md-btn is-primary" disabled={busy || !at} onClick={save}>{busy ? t('保存中…') : t('排期')}</button>
          </div>
        </div>
      ) : null}
    </>
  )
}