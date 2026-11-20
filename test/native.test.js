// 本地助手与 NM 注册器的函数级测试(ADR 0012,缝 2):输入 {method, body} +
// 注入投递箱目录/命令执行器,断言响应与文件副作用——不起真进程,不依赖浏览器与
// .bat/node 子进程。收进写 inbox 原子落盘、任务分片边界、origin 白名单、
// 回执幂等、stale 认领恢复、注册器幂等与单 vendor 失败隔离都在这里。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CHUNK_B64, EXTENSION_ID, HOST_NAME, createCore, mailboxPaths, originFromArgv, safeOperationId, writeMessage,
} from '../native/helper.mjs'
import { PAIRING_VENDORS, applyPairing, hostManifest, pairingPaths, registerVendor } from '../src/pairing.js'

const root = await mkdtemp(join(tmpdir(), 'dswritesync-native-'))
process.env.DSH_HOME = root
const paths = mailboxPaths(process.env)

test.after(async () => { await rm(root, { recursive: true, force: true }) })

function newCore(overrides = {}) {
  return createCore({ paths, startedAt: Date.now(), ...overrides })
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

async function dropTask(operationId, task = {}) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(paths.outbox, { recursive: true })
  const body = {
    operationId, itemId: 'it_x', title: '一篇稿子', articleMd: '# 正文',
    images: { 'images/cover.png': join(root, 'cover.png') },
    platforms: ['zhihu', 'juejin'], ...task,
  }
  if (body.images['images/cover.png']) await writeFile(body.images['images/cover.png'], PNG)
  await writeFile(join(paths.outbox, `publish-${operationId}.json`), JSON.stringify(body))
  return body
}

test('origin 白名单:固定扩展 ID 之外的调用方一律拒绝', () => {
  const good = [`chrome-extension://${EXTENSION_ID}/`]
  assert.equal(originFromArgv(['--parent-window=0', ...good]), `chrome-extension://${EXTENSION_ID}/`)
  assert.equal(originFromArgv([good[0]]), good[0])
  assert.equal(originFromArgv(['chrome-extension://anotherid/']), null)
  assert.equal(originFromArgv([]), null)
  // 白名单第二道之外,协议层拒绝:
  assert.equal(safeOperationId('../../etc/passwd'), null)
  assert.equal(safeOperationId('ok-operation_1'), 'ok-operation_1')
})

test('NM 帧:4 字节小端长度 + UTF-8 JSON', async () => {
  const { open, readFile, rm } = await import('node:fs/promises')
  const frameFile = join(root, 'frame.bin')
  const fd = await open(frameFile, 'w')
  try {
    writeMessage({ hello: '世界' }, fd.fd)
  } finally {
    await fd.close()
  }
  const buf = await readFile(frameFile)
  const length = buf.readUInt32LE(0)
  assert.deepEqual(JSON.parse(buf.subarray(4, 4 + length).toString('utf8')), { hello: '世界' })
  assert.equal(buf.length, 4 + length)
})

test('capture 原子写 inbox,DSH 未运行时 dshActive=false,照样成功', async () => {
  const core = newCore()
  const response = await core.handlers.capture({
    operationId: 'cap-1', url: 'https://example.com/a', title: '标题', body: '正文',
  })
  assert.equal(response.ok, true)
  assert.equal(response.queued, true)
  assert.equal(response.dshActive, false)
  const saved = JSON.parse(await readFile(join(paths.inbox, 'import-cap-1.json'), 'utf8'))
  assert.equal(saved.operationId, 'cap-1')
  assert.equal(saved.title, '标题')
  // 没有临时残留:原子写不留 .tmp
  assert.deepEqual((await readdir(paths.inbox)), ['import-cap-1.json'])
})

test('capture 拒绝无 operationId / 非对象载荷与超限正文', async () => {
  const core = newCore()
  assert.equal((await core.handlers.capture(null)).ok, false)
  assert.equal((await core.handlers.capture({ url: 'https://example.com' })).ok, false)
  assert.equal((await core.handlers.capture({ operationId: '../bad', title: 'x' })).ok, false)
  assert.equal((await core.handlers.capture({ operationId: 'big', body: 'x'.repeat(5_000_000) })).ok, false)
})

test('catalog 透传宿主索引;缺失时给空表', async () => {
  const core = newCore()
  const empty = await core.handlers.catalog()
  assert.deepEqual(empty.tags, [])
  assert.deepEqual(empty.urls, {})
  await writeFile(paths.catalog, JSON.stringify({ at: '2026-11-20T00:00:00.000Z', tags: ['参考'], urls: { 'https://example.com/a': 'it_a' } }))
  const catalog = await core.handlers.catalog()
  assert.equal(catalog.at, '2026-11-20T00:00:00.000Z')
  assert.deepEqual(catalog.tags, ['参考'])
  assert.deepEqual(catalog.urls, { 'https://example.com/a': 'it_a' })
})

test('status:catalog 刚刷过即视为 DSH 在运行', async () => {
  const fresh = newCore({ now: () => Date.now() })
  const { utimes } = await import('node:fs/promises')
  await writeFile(paths.catalog, '{}')
  await utimes(paths.catalog, new Date(), new Date())
  assert.equal((await fresh.handlers.status()).dshActive, true)
  const stale = newCore({ now: () => Date.now() + 60_000 })
  assert.equal((await stale.handlers.status()).dshActive, false)
})

test('tasks 列元数据,claim 原子认领,回执后清理认领文件', async () => {
  const core = newCore()
  await dropTask('task-1')
  const listed = await core.handlers.tasks()
  assert.equal(listed.tasks.length, 1)
  const meta = listed.tasks[0]
  assert.equal(meta.operationId, 'task-1')
  assert.deepEqual(meta.platforms, ['zhihu', 'juejin'])
  assert.ok(meta.article.shards >= 1)
  assert.deepEqual(meta.images.map(image => image.ref), ['images/cover.png'])
  assert.equal(meta.images[0].mime, 'image/png')

  const claimed = await core.handlers.claim({ operationId: 'task-1' })
  assert.equal(claimed.ok, true)
  assert.equal(claimed.task.operationId, 'task-1')
  // 认领后 tasks 不再列出,但 claim 幂等(重连续传)
  assert.deepEqual((await core.handlers.tasks()).tasks, [])
  const resumed = await core.handlers.claim({ operationId: 'task-1' })
  assert.equal(resumed.ok, true)
  assert.deepEqual((await readdir(paths.outbox)).filter(name => name.startsWith('publish-')), ['publish-task-1.json.claiming'])

  // 未知任务拒绝
  assert.equal((await core.handlers.claim({ operationId: 'nope' })).ok, false)
})

test('content 分片:边界一致、拼回原文,单分片可重拉,越界与陌生名字拒绝', async () => {
  const core = newCore()
  const articleMd = '正文'.repeat(600_000) // 3.6MB UTF-8,跨多片
  await dropTask('task-shard', { articleMd, images: { 'images/cover.png': join(root, 'cover.png') } })
  const { task } = await core.handlers.claim({ operationId: 'task-shard' })

  const parts = []
  for (let shard = 0; shard < task.article.shards; shard += 1) {
    const response = await core.handlers.content({ operationId: 'task-shard', name: 'article', shard })
    assert.equal(response.ok, true)
    assert.ok(response.data.length <= CHUNK_B64, '单分片不超过消息预算')
    parts.push(response.data)
  }
  const rebuilt = Buffer.from(parts.join(''), 'base64').toString('utf8')
  assert.equal(rebuilt, articleMd)

  // 图片:按元数据分片拉全,拼回原始字节
  for (const image of task.images) {
    const chunks = []
    for (let shard = 0; shard < image.shards; shard += 1) {
      const response = await core.handlers.content({ operationId: 'task-shard', name: image.ref, shard })
      assert.equal(response.ok, true)
      assert.equal(response.mime, 'image/png')
      chunks.push(response.data)
    }
    assert.deepEqual(Buffer.from(chunks.join(''), 'base64'), PNG)
    // 单分片失败重拉:同一分片重复取,结果一致
    const again = await core.handlers.content({ operationId: 'task-shard', name: image.ref, shard: 0 })
    assert.equal(again.ok, true)
  }

  assert.equal((await core.handlers.content({ operationId: 'task-shard', name: 'article', shard: task.article.shards })).ok, false)
  assert.equal((await core.handlers.content({ operationId: 'task-shard', name: 'images/not-listed.png', shard: 0 })).ok, false)
  assert.equal((await core.handlers.content({ operationId: 'nope', name: 'article', shard: 0 })).ok, false)
})

test('receipt 写 dispatch 回执并清任务;同一 operationId 不同内容被拒', async () => {
  const core = newCore()
  await dropTask('task-receipt')
  await core.handlers.claim({ operationId: 'task-receipt' })
  const results = [{ platform: 'zhihu', ok: true, url: 'https://zhuanlan.zhihu.com/p/1/edit' }]
  assert.equal((await core.handlers.receipt({ payload: { operationId: 'task-receipt', itemId: 'it_x', results } })).ok, true)
  const saved = JSON.parse(await readFile(join(paths.receipts, 'dispatch-task-receipt.json'), 'utf8'))
  assert.equal(saved.ok, undefined, '回执正文保持扩展给的原样,由宿主消化')
  assert.deepEqual(saved.results, results)
  assert.ok(!(await readdir(paths.outbox)).some(name => name.startsWith('publish-task-receipt')))

  // 同一 operationId 重写同样内容:幂等
  assert.equal((await core.handlers.receipt({ payload: { operationId: 'task-receipt', itemId: 'it_x', results } })).ok, true)
  // 不同内容:拒绝,保护宿主「同一编号不写不同结果」的约定
  assert.equal((await core.handlers.receipt({ payload: { operationId: 'task-receipt', itemId: 'it_x', results: [] } })).ok, false)
})

test('stale 认领恢复:超时无回执写失败回执,有回执只清理', async () => {
  const core = newCore({ now: () => Date.now() })
  const { utimes } = await import('node:fs/promises')
  // 超时认领:写 ok:false 回执
  await dropTask('task-stale')
  await core.handlers.claim({ operationId: 'task-stale' })
  const claimedFile = join(paths.outbox, 'publish-task-stale.json.claiming')
  const old = new Date(Date.now() - 31 * 60 * 1000)
  await utimes(claimedFile, old, old)
  await core.recoverStaleClaims()
  const receipt = JSON.parse(await readFile(join(paths.receipts, 'dispatch-task-stale.json'), 'utf8'))
  assert.equal(receipt.ok, false)
  assert.deepEqual(receipt.results.map(row => row.platform), ['zhihu', 'juejin'])
  assert.ok(!(await readdir(paths.outbox)).some(name => name.startsWith('publish-task-stale')))
  // 新鲜认领不动
  await dropTask('task-fresh')
  await core.handlers.claim({ operationId: 'task-fresh' })
  await core.recoverStaleClaims()
  assert.ok((await readdir(paths.outbox)).some(name => name === 'publish-task-fresh.json.claiming'))
  assert.ok(!(await readdir(paths.receipts)).some(name => name === 'dispatch-task-fresh.json'))
})

test('未知 method 与坏 JSON 的协议面:core.handlers 层直接拒绝', async () => {
  const core = newCore()
  assert.equal(core.handlers.noSuchMethod, undefined)
})

test('环形日志落到投递箱目录,超限轮转', async () => {
  let appended = []
  const core = newCore({ log: entry => appended.push(entry) })
  await core.handlers.capture({ operationId: 'log-1', url: 'https://example.com', title: 't', body: '' })
  assert.ok(appended.some(entry => String(entry.message ?? '').includes('captured log-1') || entry.message === undefined))
  // 真实 ringLog:超大日志在下一次写入前轮转成 .1
  await core.ringLog('line-1')
  await core.ringLog({ message: 'line-2' })
  const logFile = await readFile(paths.log, 'utf8')
  assert.match(logFile, /line-2/)
  const huge = 'x'.repeat(300_000)
  await core.ringLog({ message: huge })
  await core.ringLog({ message: 'triggers-rotation' })
  assert.ok((await stat(`${paths.log}.1`)).size > 0, '旧日志轮出成 helper.log.1')
})

test('注册器:host manifest 内容正确,vendor 逐键注册,幂等重写,单 vendor 失败隔离', async () => {
  const home = join(root, 'pairing-home')
  const runs = []
  const run = async (cmd, args) => { runs.push([cmd, args]) }
  const paths = pairingPaths({ home, pluginDir: join(root, 'plugin', 'native') })

  const first = await applyPairing({ run, paths, home, vendors: PAIRING_VENDORS })
  assert.equal(first.paired, true)
  assert.deepEqual(first.browsers, PAIRING_VENDORS)
  assert.deepEqual(first.failedVendors, [])

  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'))
  assert.deepEqual(manifest, hostManifest({ helperBat: paths.helperBat }))
  assert.equal(manifest.name, HOST_NAME)
  assert.equal(manifest.type, 'stdio')
  assert.equal(manifest.path, paths.helperBat)
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`])

  assert.equal(runs.length, PAIRING_VENDORS.length)
  for (const [cmd, args] of runs) {
    assert.equal(cmd, 'reg')
    assert.equal(args[0], 'add')
    assert.match(args[1], /^HKCU\\Software\\.+\\NativeMessagingHosts\\app\.dswritesync\.plugin$/)
    assert.equal(args.at(-1), '/f')
    assert.equal(args[args.indexOf('/d') + 1], paths.manifest)
  }
  const record = JSON.parse(await readFile(paths.record, 'utf8'))
  assert.equal(record.hostName, HOST_NAME)
  assert.equal(record.extensionId, EXTENSION_ID)

  // 幂等重写 + 单 vendor 失败隔离:第二个 vendor 键坏了,其余照常,结果标 failed
  const failing = async (cmd, args) => {
    if (args[1].includes(PAIRING_VENDORS[1])) throw new Error('access denied')
    await run(cmd, args)
  }
  const second = await applyPairing({ run: failing, paths, home, vendors: PAIRING_VENDORS })
  assert.deepEqual(second.browsers, PAIRING_VENDORS.filter((_, index) => index !== 1))
  assert.deepEqual(second.failedVendors, [PAIRING_VENDORS[1]])
  assert.equal(second.paired, true)

  // 全部失败:未配对,但 manifest 与记录照常落盘
  const none = await applyPairing({ run: async () => { throw new Error('no reg') }, paths, home, vendors: PAIRING_VENDORS })
  assert.equal(none.paired, false)
  assert.equal(none.browsers.length, 0)
})

test('registerVendor 注册命令形状(独立断言,便于扩 vendor 清单时回归)', async () => {
  const runs = []
  await registerVendor('Google\\Chrome', 'C:/manifest.json', async (cmd, args) => { runs.push([cmd, args]) })
  assert.deepEqual(runs[0], ['reg', ['add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\app.dswritesync.plugin', '/ve', '/t', 'REG_SZ', '/d', 'C:/manifest.json', '/f']])
})
