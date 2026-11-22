// 排期提醒:到点后在应用里弹一条横幅(系统通知 DSH 未开放 API,别指望桌面通知)。
// 挂在宿主 layout 的 shell.overlay 全局常驻槽位(根级 list,跨主面板可见),
// 所以这里不能用 .md-root 里的样式与变量,颜色/圆角在本文件对应的 CSS 里自带一份。
//
// 规则(与 ScheduleBox 的「系统提示」开关同一条链):
// - 只提醒还没被 ack 的那一次:reminderDue() 比对 scheduledAt 与 remindedAt;
// - 只有「知道了」会关掉它(写 remindedAt,ack_reminder 静默、不进撤销栈);
// - 改期会清 remindedAt,所以新的时间点会再提醒一次;
// - 一张胶囊只提醒一条,不按成员炸出十条。
import React from 'react'
import { EMPTY_LIST, dispatchOps, openItem, refreshState, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'
import { fmtWhen } from './util.js'
import { reminderDue } from '../src/state.js'

const TICK_MS = 30_000
// 浏览器本地的已读回执:宿主服务端可能还是旧进程(host 半片只在 DSH 启动时加载),
// 这时 ack_reminder 会报「不支持的操作」。本地先记住这一次,横幅立刻收起;
// 等服务端更新后,同一次点击仍会写进 state.remindedAt,本地只是兜底。
const ACK_STORE = 'md.reminder.acked'
const ACK_LIMIT = 120

function readAcked() {
  try {
    if (typeof window === 'undefined') return new Set()
    const rows = JSON.parse(window.localStorage.getItem(ACK_STORE) || '[]')
    return new Set(Array.isArray(rows) ? rows.filter(row => typeof row === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveAcked(acked) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(ACK_STORE, JSON.stringify([...acked].slice(-ACK_LIMIT)))
  } catch {
    // 隐私模式 / 存储满:本地兜底失败就只靠服务端,不打断点击
  }
}

/** 同一条排期(含时间)只 ack 一次;改期后时间变了,新提醒照常出现。 */
function ackKey(alert) {
  return `${alert.key}@${alert.at}`
}

/**
 * 把到点且未 ack 的素材收敛成「一条提醒」:胶囊按 capsule.id 去重(整张胶囊一起成稿),
 * 散条按 item.id;按排期时间从早到晚排,先处理最该处理的那条。
 */
function dueAlerts(items, capsules, now) {
  const seen = new Set()
  const alerts = []
  for (const item of items) {
    if (!reminderDue(item, now)) continue
    const capsule = capsules.find(row => (row.itemIds ?? []).includes(item.id))
    const key = capsule ? `capsule:${capsule.id}` : `item:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const members = capsule
      ? (capsule.itemIds ?? []).map(id => items.find(row => row.id === id)).filter(Boolean)
      : [item]
    alerts.push({ key, capsule, item, members, at: item.scheduledAt })
  }
  return alerts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

function ReminderBanner({ panelId, layout }) {
  const items = useDesk(state => state.state?.items ?? EMPTY_LIST)
  const capsules = useDesk(state => state.state?.capsules ?? EMPTY_LIST)
  const [tick, setTick] = React.useState(0)
  const [acked, setAcked] = React.useState(readAcked)

  React.useEffect(() => {
    // 排期可能是在另一个窗口里改的,这里每 30 秒补拉一次状态再重算到点集合
    const timer = setInterval(() => {
      setTick(n => n + 1)
      refreshState()
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const alerts = React.useMemo(() => dueAlerts(items, capsules, new Date()).filter(alert => !acked.has(ackKey(alert))), [items, capsules, tick, acked])
  if (!alerts.length) return null

  const [alert] = alerts
  const { capsule, item, members } = alert
  const title = capsule?.name || item.title || t('（无标题）')

  const open = () => {
    // 面板没打开时先把创作台切出来,再开统一编辑弹层(里面就有排期设置)
    layout?.selectPanel?.(panelId)
    openItem(item.id)
  }
  const ack = () => {
    const next = new Set(acked)
    next.add(ackKey(alert))
    saveAcked(next)
    setAcked(next)
    // 服务端 ack 负责持久化;本地已先收起,失败也不弹错误打断阅读
    dispatchOps([{ op: 'ack_reminder', id: item.id }], { label: t('知道了'), undoable: false, silent: true, quiet: true })
  }

  return (
    <div className="md-reminder" role="status" aria-live="polite">
      <span className="md-reminder-icon" aria-hidden="true"><Icon name="clock" size={16} /></span>
      <div className="md-reminder-main">
        <span className="md-reminder-eyebrow">
          {t('排期到点')} · {fmtWhen(item.scheduledAt)}
        </span>
        <span className="md-reminder-title">{title}</span>
        <span className="md-reminder-meta">
          {capsule
            ? t('整张胶囊 {n} 张素材，一起成稿', { n: members.length })
            : t('该成稿了')}
          {alerts.length > 1 ? t(' · 还有 {n} 条提醒', { n: alerts.length - 1 }) : ''}
        </span>
      </div>
      <div className="md-reminder-actions">
        <button type="button" className="md-reminder-btn" onClick={open}>{t('去处理')}</button>
        <button type="button" className="md-reminder-btn is-primary" onClick={ack}>{t('知道了')}</button>
      </div>
    </div>
  )
}

/**
 * 注册到 shell.overlay:槽位是 root 级常驻浮层、默认点击穿透,
 * 所以横幅自己在 CSS 里开 pointer-events,位置也自己固定。
 * 槽位不存在(旧宿主)时静默跳过,提醒降级为不出现,别让整个客户端插件挂掉。
 */
export function mountScheduleReminder(ctx, panelId) {
  if (typeof ctx.slots?.inject !== 'function') return
  const layout = ctx.layout
  try {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'writing-desk-reminder' }, () => (
        <ReminderBanner panelId={panelId} layout={layout} />
      )),
    )
  } catch (error) {
    console.warn('[dsh-writing-desk] reminder banner skipped:', error)
  }
}