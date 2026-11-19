// 客户端接线：用到的版本 API 必须真的 import 进来。
// esbuild 不会对未定义变量报错（它按全局变量处理），少了 import 只会在渲染时 ReferenceError。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const DIR = new URL('../client/', import.meta.url)

// 各模块导出的 API 与组件用法：openProduce/openCapsule/openRetag 是函数调用，CapsuleCard 等是 JSX 组件
// 工单 #6：统一成稿入口——编辑界面 / 画布多选 / 胶囊对话框 / 标签资料架都要经 desk.js 的 openProduce 进同一个工作面
// 工单 #9：发布交接——成稿工作面经 desk.js 的 exportForPublish 导出发布包
const WIRED = [
  ['./desk.js', ['openProduce', 'openCapsule', 'openRetag', 'toggleSelect', 'clearSelection', 'exportForPublish'], name => `${name}(`],
  ['./capsule.jsx', ['CapsuleCard', 'CapsuleView'], name => `<${name}`],
  ['./produce.jsx', ['ProduceView'], name => `<${name}`],
  ['./retag.jsx', ['RetagDialog'], name => `<${name}`],
]

for (const file of readdirSync(DIR)) {
  if (!file.endsWith('.jsx')) continue
  const source = readFileSync(new URL(file, DIR), 'utf8')
  const imported = /import\s*\{([^}]*)\}\s*from\s*'\.\/version\.js'/.exec(source)?.[1] ?? ''
  for (const name of ['useVersionInfo', 'updateUrl']) {
    if (!source.includes(`${name}(`)) continue
    test(`${file}：用 ${name}() 之前先从 ./version.js import`, () => {
      assert.ok(imported.includes(name), `${file} 用了 ${name}()，却没从 ./version.js import`)
    })
  }
  for (const [module, names, used] of WIRED) {
    const imported = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'\\.${module.slice(1).replace(/\./g, '\\.')}'`).exec(source)?.[1] ?? ''
    for (const name of names) {
      if (!source.includes(used(name))) continue
      test(`${file}：用 ${name} 之前先从 ${module} import`, () => {
        assert.ok(imported.includes(name), `${file} 用了 ${name}，却没从 ${module} import`)
      })
    }
  }
}

// 统一成稿入口(工单 #6):client 侧的输入归一与 Host 共用同一个解析模块,不许各写一套。
// ADR 0006 后入口在 session-link.js(引用到对话/去创作会话),不在 desk.js。
test('session-link.js：统一成稿入口与 Host 共用 produce-input 解析模块', () => {
  const source = readFileSync(new URL('./session-link.js', DIR), 'utf8')
  assert.match(source, /import\s*\{[^}]*resolveProduceInput[^}]*\}\s*from\s*'\.\.\/src\/produce-input\.js'/)
})

// 成稿操作页已退役(ADR 0006):produce 页与它的 live/进度体系不再回来
test('produce 操作页已删除,写回链路没有内置流水线痕迹', () => {
  assert.throws(() => readFileSync(new URL('produce.jsx', DIR), 'utf8'), { code: 'ENOENT' }, 'produce.jsx 应已删除')
  const desk = readFileSync(new URL('./desk.js', DIR), 'utf8')
  for (const fn of ['runProduce', 'cancelProduce', 'regenAsset', 'watchProduction', 'testImage']) {
    assert.ok(!desk.includes(fn), `desk.js 不应再有内置流水线入口 ${fn}`)
  }
})

// 状态权威迁移(工单 #5):四个面板的「已成稿 / 已排期 / 面板状态」判断统一走 src/state.js
// 的共享谓词,不许再内联等价判断——四套字段各说各话正是历史不一致的根源。
// 灵感墙改造后,墙面只放灵感、不画成稿状态(卡上不再有四色状态),所以状态谓词只剩
// 收发室(内容页)与排期页两处;墙与卡仍受「不许内联」约束,防止旧口径偷偷回流。
const PANELS = ['content.jsx', 'schedule.jsx']
const IDEA_SURFACES = ['wall.jsx', 'card.jsx', 'capsule.jsx']
const SHARED_PREDICATE = /import\s*\{[^}]*\b(?:panelState|isDrafted|isScheduled)\b[^}]*\}\s*from\s*'\.\.\/src\/state\.js'/

test('面板的状态口径统一走 src/state.js 共享谓词', () => {
  for (const file of PANELS) {
    const source = readFileSync(new URL(file, DIR), 'utf8')
    assert.match(source, SHARED_PREDICATE, `${file} 要从 src/state.js 引共享谓词`)
  }
  for (const file of [...PANELS, ...IDEA_SURFACES]) {
    const source = readFileSync(new URL(file, DIR), 'utf8')
    for (const [pattern, what] of [
      [/production\??\.status\s*===\s*'(running|done)'/, 'production.status 判断'],
      [/drafts\??\.article/, 'drafts.article 遗留口径'],
      [/status\s*!==\s*'published'/, '已排期判断'],
    ]) {
      assert.doesNotMatch(source, pattern, `${file} 内联了${what},改用共享谓词`)
    }
  }
})

// 校样浮层的相位是写回相位(快照与 pendingWrite 派生),不是状态元组:
// 它不得内联状态元组判断,面板口径仍只有共享谓词一个来源
test('校样浮层不内联状态元组判断', () => {
  const source = readFileSync(new URL('proof.jsx', DIR), 'utf8')
  assert.doesNotMatch(source, /production\??\.status\s*===\s*'(running|done)'/, 'proof.jsx 内联了 production.status 判断')
  assert.doesNotMatch(source, /\bdrafts\??\.article/, 'proof.jsx 内联了遗留草稿口径')
  assert.match(source, /snapshots/, '写回相位从快照派生')
})

// 复盘与 Monid 已整体裁剪(ADR 0005):导航、数据采集入口与相关路由都不再出现
test('复盘与 Monid 已整体裁剪,主流程没有数据采集入口(ADR 0005)', () => {
  const index = readFileSync(new URL('./index.jsx', DIR), 'utf8')
  assert.doesNotMatch(index, /insights/, '导航里不应再有复盘')
  const desk = readFileSync(new URL('./desk.js', DIR), 'utf8')
  for (const fn of ['fetchInsights', 'importAccount', 'monidStatus', 'learnSkills', 'feedbackSkills', 'refreshAccount']) {
    assert.ok(!desk.includes(fn), `desk.js 不应再有数据采集/提炼入口 ${fn}`)
  }
  for (const route of ['monid/', 'insights', 'skills/learn', 'skills/feedback', 'account/refresh']) {
    assert.ok(!desk.includes(`'${route}'`), `desk.js 不应再接 ${route} 路由`)
  }
  const learn = readFileSync(new URL('../src/learn.js', DIR), 'utf8')
  assert.doesNotMatch(learn, /learnFromEdits|proposeRules|computeInsights/, 'learn.js 只留 Skill 导出')
})

// 遗留口径清理(工单 #7):草稿字段已整体下线,client 的任何面板都不许再引用它
test('client 不再引用遗留的草稿字段口径', () => {
  for (const file of readdirSync(DIR)) {
    if (!file.endsWith('.jsx')) continue
    const source = readFileSync(new URL(file, DIR), 'utf8')
    assert.doesNotMatch(source, /\bdrafts\b/, `${file} 还在引用遗留的草稿字段`)
  }
})

// React #185 防复发:useDesk 走 useSyncExternalStore,选择器缺字段时用 ?? [] 兜底
// 会在每次渲染返回新数组,判定为快照持续变化,无限重渲染直到 'main' slot 崩溃。
// 缺字段一律回落 desk.js 导出的 EMPTY_LIST(同一个引用)。
test('useDesk 选择器不得每次渲染返回新数组(React #185 防复发)', () => {
  for (const file of readdirSync(DIR)) {
    if (!file.endsWith('.jsx') && !file.endsWith('.js')) continue
    const source = readFileSync(new URL(file, DIR), 'utf8')
    assert.doesNotMatch(source, /useDesk\([^\n]*\?\? \[\]/, `${file} 的 useDesk 选择器里还有 ?? [],要改用 desk.js 的 EMPTY_LIST`)
  }
})
