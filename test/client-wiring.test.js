// 客户端接线：用到的版本 API 必须真的 import 进来。
// esbuild 不会对未定义变量报错（它按全局变量处理），少了 import 只会在渲染时 ReferenceError。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const DIR = new URL('../client/', import.meta.url)

// 各模块导出的 API 与组件用法：openProduce/openCapsule/openRetag 是函数调用，Editor 等是 JSX 组件
// 工单 #6：统一成稿入口——编辑界面 / 画布多选 / 胶囊对话框 / 标签资料架都要经 desk.js 的 openProduce 进同一个工作面
// 工单 #9：发布交接——成稿工作面经 desk.js 的 exportForPublish 导出发布包
const WIRED = [
  ['./desk.js', ['openProduce', 'openCapsule', 'openRetag', 'toggleSelect', 'clearSelection', 'exportForPublish', 'feedbackSkills'], name => `${name}(`],
  ['./editor.jsx', ['Editor'], name => `<${name}`],
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

// 统一成稿入口(工单 #6):client 侧的输入归一与 Host 共用同一个解析模块,不许各写一套
test('desk.js：统一成稿入口与 Host 共用 produce-input 解析模块', () => {
  const source = readFileSync(new URL('./desk.js', DIR), 'utf8')
  assert.match(source, /import\s*\{[^}]*resolveProduceInput[^}]*\}\s*from\s*'\.\.\/src\/produce-input\.js'/)
})

// 状态权威迁移(工单 #5):四个面板的「已成稿 / 已排期 / 面板状态」判断统一走 src/state.js
// 的共享谓词,不许再内联等价判断——四套字段各说各话正是历史不一致的根源。
const PANELS = ['card.jsx', 'content.jsx', 'schedule.jsx', 'canvas.jsx']
const SHARED_PREDICATE = /import\s*\{[^}]*\b(?:panelState|isDrafted|isScheduled)\b[^}]*\}\s*from\s*'\.\.\/src\/state\.js'/

test('四个面板的状态口径统一走 src/state.js 共享谓词', () => {
  for (const file of PANELS) {
    const source = readFileSync(new URL(file, DIR), 'utf8')
    assert.match(source, SHARED_PREDICATE, `${file} 要从 src/state.js 引共享谓词`)
    for (const [pattern, what] of [
      [/production\??\.status\s*===\s*'(running|done)'/, 'production.status 判断'],
      [/drafts\??\.article/, 'drafts.article 遗留口径'],
      [/status\s*!==\s*'published'/, '已排期判断'],
    ]) {
      assert.doesNotMatch(source, pattern, `${file} 内联了${what},改用共享谓词`)
    }
  }
})

// 成稿工作面(工单 #6 后的 produce 相关文件)里「正在成稿」的面板判断同样走共享谓词
test('成稿工作面的成稿中判断走共享谓词', () => {
  const source = readFileSync(new URL('produce.jsx', DIR), 'utf8')
  assert.match(source, SHARED_PREDICATE, 'produce.jsx 要从 src/state.js 引共享谓词')
})

// 工单 #10:数据面板降级为可选模块——导航带「可选」标识,首页/主流程不出现数据采集入口
test('复盘导航标注为可选模块,主流程不引数据采集(工单 #10)', () => {
  const index = readFileSync(new URL('./index.jsx', DIR), 'utf8')
  assert.match(index, /\{\s*id:\s*'insights',[^\n]*optional:\s*true/, '导航里的复盘要带 optional 标识')
  const home = readFileSync(new URL('./canvas.jsx', DIR), 'utf8')
  for (const fn of ['fetchInsights', 'importAccount', 'monidStatus']) {
    assert.ok(!home.includes(fn), `首页/主流程不应出现数据采集入口 ${fn}`)
  }
})

// 工单 #10:风格闭环——成稿反馈走 desk.js 的 feedbackSkills → Host 的 skills/feedback
test('成稿反馈入口接在共享提炼函数上(工单 #10)', () => {
  const desk = readFileSync(new URL('./desk.js', DIR), 'utf8')
  assert.match(desk, /'skills\/feedback'/, 'desk.js 要接 skills/feedback 路由')
  const learn = readFileSync(new URL('../src/learn.js', DIR), 'utf8')
  assert.match(learn, /export function learnFromEdits/, 'Host 要导出 learnFromEdits 供反馈提炼共用')
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
