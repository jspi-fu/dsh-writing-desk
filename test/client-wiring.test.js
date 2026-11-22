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
const WORK_SURFACES = ['content.jsx']
const PANELS = ['schedule.jsx']
const IDEA_SURFACES = ['wall.jsx', 'card.jsx', 'capsule.jsx']
const SHARED_PREDICATE = /import\s*\{[^}]*\b(?:awaitingSchedule|isScheduled|reminderDue)\b[^}]*\}\s*from\s*'\.\.\/src\/state\.js'/
const SHARED_WORK = /import\s*\{[^}]*\b(?:workState|workHasText|workTitle|PUBLICATION_LABEL)\b[^}]*\}\s*from\s*'\.\.\/src\/work\.js'/

test('面板的状态口径统一走 src/state.js 与 src/work.js 共享谓词', () => {
  for (const file of WORK_SURFACES) {
    const source = readFileSync(new URL(file, DIR), 'utf8')
    assert.match(source, SHARED_WORK, `${file} 要从 src/work.js 引作品状态谓词`)
  }
  for (const file of PANELS) {
    const source = readFileSync(new URL(file, DIR), 'utf8')
    assert.match(source, SHARED_PREDICATE, `${file} 要从 src/state.js 引共享谓词`)
  }
  for (const file of [...PANELS, ...WORK_SURFACES, ...IDEA_SURFACES]) {
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

// 校样浮层已换成作品编辑器(ADR 0015):旧 proof.jsx 与快照相位不许回来
test('校样浮层已换成作品编辑器,不再有旧快照口径', () => {
  assert.throws(() => readFileSync(new URL('proof.jsx', DIR), 'utf8'), { code: 'ENOENT' }, 'proof.jsx 应已删除')
  const source = readFileSync(new URL('work-editor.jsx', DIR), 'utf8')
  assert.doesNotMatch(source, /production\??\.status\s*===\s*'(running|done)'/, 'work-editor.jsx 内联了 production.status 判断')
  assert.doesNotMatch(source, /\bdrafts\??\.article/, 'work-editor.jsx 内联了遗留草稿口径')
  assert.doesNotMatch(source, /snapshots/, '作品编辑器不再有快照相位(ADR 0014)')
  assert.match(source, /saveWorkFiles/, '保存走作品落盘接口')
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

// 拖拽接线(ADR 0011 补充):灵感卡与胶囊卡都能拖走,落手由接驳条在 window 捕获阶段接管,
// 灵感墙上一张卡拖到另一张卡上 = 合成胶囊。这三处任何一处掉线,用户看到的就是「拖不动」。
test('拖拽接线：卡能拖、接驳条接管落手、墙面卡到卡合成胶囊', () => {
  const card = readFileSync(new URL('./card.jsx', DIR), 'utf8')
  assert.match(card, /startRefDrag\(\{\s*itemIds/, '灵感卡开始拖时要通知接驳条')
  assert.match(card, /endRefDrag\(\)/, '灵感卡拖完要收回落点提示')

  const capsule = readFileSync(new URL('./capsule.jsx', DIR), 'utf8')
  assert.match(capsule, /setData\('text\/writing-desk-capsule', capsule\.id\)/)
  assert.match(capsule, /onDragStart=\{dragStart\}/, '胶囊卡要真的挂上拖拽')
  assert.match(capsule, /startRefDrag\(\{\s*capsuleIds/, '胶囊卡开始拖时要通知接驳条')

  const dock = readFileSync(new URL('./dock.jsx', DIR), 'utf8')
  assert.match(dock, /addEventListener\('drop', onWindowDrop, true\)/, '落手在 window 捕获阶段接管')
  assert.match(dock, /rows\(dt\.getData\('text\/writing-desk-capsule'\)\)/, '胶囊 ID 单独成条,不混进灵感 ID')
  assert.match(dock, /registerDockRect\(\(\) => zoneRectOf\(elRef\.current\)\)/, '落点要放大到整块输入卡')
  assert.match(dock, /addReferenceToCurrentSession\(entries\)/, '落手要与「添加到当前会话」按钮同一条路')
  assert.doesNotMatch(dock, /referenceIntoDraft|md-dock-chips/, '接驳条不再自己画签条、不再整段替换草稿')

  const wall = readFileSync(new URL('./wall.jsx', DIR), 'utf8')
  assert.match(wall, /op: 'add_capsule', itemIds: \[entry\.item\.id/, '拖到另一张卡上合成胶囊')
  assert.match(wall, /is-merge/, '合并目标要能看出高亮')
})

// 胶囊改名(需求):浮层标题点一下就地编辑,回车/失焦即存,只走 update_capsule 的 name;
// 输入框里按 Esc 只还原名字,不能连浮层一起关掉。
test('胶囊改名：标题可点开编辑,提交落 update_capsule 的 name', () => {
  const capsule = readFileSync(new URL('./capsule.jsx', DIR), 'utf8')
  assert.match(capsule, /op: 'update_capsule', id: capsule\.id, name/, '改名要落在 update_capsule 的 name 上')
  assert.match(capsule, /onBlur=\{commit\}/, '点到别处要自动保存')
  assert.match(capsule, /<CapsuleName capsule=\{capsule\} \/>/, '浮层标题要用可编辑的那一个')
  assert.match(capsule, /const typing = event\.target\.closest\?\.\('input,textarea,select'\)/, 'Esc 要先看焦点在不在输入框里')
})

// 胶囊是一张卡(ADR 0011):排期与成稿都按整体算,托盘里不拆成员
test('排期页把胶囊当一张卡：拖到日历全体一起排、成稿按整张走', () => {
  const schedule = readFileSync(new URL('./schedule.jsx', DIR), 'utf8')
  assert.match(schedule, /awaitingSchedule\(state, item\)/, '待排期托盘要用共享谓词')
  assert.doesNotMatch(schedule, /capsuleDrafted/, '胶囊已用口径改由作品引用派生,不再看素材状态')
  assert.match(schedule, /const members = capsule\.itemIds\.map\(itemId => byId\.get\(itemId\)\)/, '拖到日历要取全部成员')
  assert.doesNotMatch(schedule, /filter(row => row && awaitingSchedule(row))/, '不能只排还没排期的成员,否则一张胶囊摊在两处')
})

// 来源打开是整组按钮：箭头只是语义提示，不能成为唯一可点目标；胶囊里还要隔离排序与整卡打开。
test('灵感来源文字与箭头共用打开入口，胶囊内不冒泡成编辑或拖拽', () => {
  const card = readFileSync(new URL('./card.jsx', DIR), 'utf8')
  assert.match(card, /className="md-tile-site md-tile-source"[\s\S]*?onClick=\{open\}/)
  assert.match(card, /onPointerDown=\{event => event\.stopPropagation\(\)\}/)
  assert.doesNotMatch(card, /className="md-tile-open"/, '外链箭头不再单独充当按钮')

  const capsule = readFileSync(new URL('./capsule.jsx', DIR), 'utf8')
  assert.match(capsule, /if \(event\.target !== event\.currentTarget\) return/, '成员卡键盘事件只处理当前包装格，不抢来源按钮的事件')
})

// 胶囊成员是等宽等高的两列网格，不用瀑布流或取消两行标题最低高度来制造参差。
test('胶囊成员两列等尺寸，头部图标在窄栏保持清晰', () => {
  const styles = readFileSync(new URL('./styles.css', DIR), 'utf8')
  assert.match(styles, /\.md-pile-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 12px; align-items: stretch; \}/)
  assert.match(styles, /\.md-pile-card > \.md-tile\.is-bare \{ display: flex; flex-direction: column; height: 100%; \}/)
  assert.match(styles, /\.md-pile-card \.md-tile\.is-bare \.md-tile-title \{ min-height: calc\(1\.42em \* 2\); \}/)
  assert.match(styles, /\.md-root \.md-capsule-action svg \{ flex: none; width: 22px; height: 22px; \}/)
})
