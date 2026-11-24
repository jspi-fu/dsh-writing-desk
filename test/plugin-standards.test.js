// 当前版本插件标准的接线防复发：硬依赖按参考项目声明、槽位唯一注册、样式随组件所在渲染树注入。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const client = (name) => readFileSync(new URL('../client/' + name, import.meta.url), 'utf8')

test('右侧栏与提醒所需服务按当前支持方式声明为硬依赖', () => {
  const source = client('index.jsx')
  const inject = /export const inject = \[([^\]]*)\]/.exec(source)?.[1] ?? ''
  assert.ok(inject.includes('sidebarRightTabs'), '与参考项目 StashDock 一致，右侧栏类型服务是当前支持的硬依赖')
  assert.ok(inject.includes('layout'), 'reminder.jsx 在 apply 期取 ctx.layout，必须声明以保证时序')
  const mount = source.slice(source.indexOf('function mountRightSidebarTab'), source.indexOf('function GuideIcon'))
  assert.ok(mount.includes('ctx.sidebarRightTabs.register({'), '直接用注入的服务，不做一次性软探测')
  assert.ok(!mount.includes("ctx.get?.('sidebarRightTabs')"), '不再留软探测兜底')
  assert.ok(!mount.includes('try {'), '不再用 try/catch 吞掉注册失败')
})

test('接驳条只注册当前槽位，样式随组件注入会话输入槽', () => {
  const index = client('index.jsx')
  const mount = index.slice(index.indexOf('function mountInputDock'), index.indexOf('function mountWorkspace'))
  assert.ok(mount.includes("const name = 'conversation.input.dock'"), '注册当前槽位')
  assert.ok(!mount.includes('for (const name of'), '不再循环注册旧槽位造成双实例争抢单例')
  assert.ok(mount.includes("ctx.slots.register({ name, id: 'writing-desk-dock' }, DockRail)"))

  const dock = client('dock.jsx')
  assert.ok(dock.includes("import css from './dock.css'"), 'dock 样式要自己引入')
  assert.ok(dock.includes('<style>{css}</style>'), '样式必须随 DockRail 注入它所在的渲染树')
  assert.ok(dock.includes('data-input-dock-entry="writing-desk"'), '不要再沿用旧槽名属性')

  const styles = client('styles.css')
  assert.ok(!styles.includes('.md-dock {'), 'main 槽样式里的旧 .md-dock 规则应迁走')
  const dockCss = client('dock.css')
  assert.ok(dockCss.includes('.md-dock.is-listening'), 'listening 态样式要保留')
  assert.ok(dockCss.includes('.md-dock.is-armed'), 'armed 态样式要保留')
  assert.ok(!dockCss.includes('.md-dock.is-landed'), 'is-landed 没有任何赋值，是死样式，已删')
  assert.ok(dockCss.includes('prefers-reduced-motion'), '动效要有减少动态效果回退')
})

test('证据链样式随 StyleView 注入', () => {
  const style = client('style.jsx')
  assert.ok(style.includes("import evidenceCss from './style-evidence.css'"))
  assert.ok(style.includes('<style>{evidenceCss}</style>'), 'evidenceCss 之前从未注入')
  const evidence = client('style-evidence.css')
  assert.ok(evidence.includes('.md-rule .md-rule-evidence'))
})
