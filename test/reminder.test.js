import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const jsx = readFileSync(new URL('../client/reminder.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../client/reminder.css', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../client/styles.css', import.meta.url), 'utf8')

test('提醒横幅自带样式：CSS 与横幅一起渲染到 overlay，不依赖主面板的 <style>', () => {
  assert.match(jsx, /import css from '\.\/reminder\.css'/)
  // <style> 必须是横幅组件自己的子节点，才会跟它一起进 shell.overlay 槽位；
  // 只写在 index.jsx 的 Desk 里会留在 main 槽位，横幅拿到的是裸 HTML。
  const banner = jsx.slice(jsx.indexOf('function ReminderBanner'), jsx.indexOf('export function mountScheduleReminder'))
  assert.match(banner, /<style>\{css\}<\/style>/)
  assert.match(banner, /className="md-reminder" role="status" aria-live="polite"/)
})

test('styles.css 不再持有提醒横幅样式，避免两处样式源', () => {
  assert.doesNotMatch(styles, /\.md-reminder[\s\S]*?pointer-events:\s*auto/)
})

test('横幅固定在底部中间、点击可用，入场动画完整且尊重 reduced-motion', () => {
  const block = css.match(/\.md-reminder\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.match(block, /position:\s*fixed/)
  assert.match(block, /left:\s*50%/)
  assert.match(block, /bottom:\s*24px/)
  assert.match(block, /transform:\s*translateX\(-50%\)/)
  assert.match(block, /pointer-events:\s*auto/)
  assert.match(block, /animation:\s*md-reminder-in/)

  const keyframes = css.match(/@keyframes md-reminder-in\s*\{([^}]*\}[^}]*)\}/)?.[1] ?? ''
  assert.match(keyframes, /from\s*\{[^}]*translate\(-50%,\s*12px\)/)
  assert.match(keyframes, /to\s*\{[^}]*translate\(-50%,\s*0\)/)

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.md-reminder\s*\{[^}]*animation:\s*none/)
})
