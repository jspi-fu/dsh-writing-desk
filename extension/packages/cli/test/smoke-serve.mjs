// serve 冒烟：mock WS 扩展客户端走一遍 Desk 协议 v1 与投递箱。
// 覆盖：auth.json 生成、错误 token 拒绝、hello 后 desk.capture 落 inbox、
// import 回执推 capture-result、outbox 任务触发 syncArticle 并写 dispatch 回执。
// 运行前需先构建 CLI（dist/index.js）。用 DSH_HOME 指向临时目录，不碰真实工作台数据。
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const home = mkdtempSync(join(tmpdir(), 'dswritesync-smoke-'))
process.env.DSH_HOME = home
const bin = fileURLToPath(new URL('../dist/index.js', import.meta.url))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitFor(fn, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await fn()
    if (value) return value
    await wait(intervalMs)
  }
  throw new Error('waitFor timeout')
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMessage(ws, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('message timeout'))
    }, timeoutMs)
    const onMessage = raw => {
      let message
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (predicate(message)) {
        cleanup()
        resolve(message)
      }
    }
    const onClose = () => {
      cleanup()
      reject(new Error('connection closed before expected message'))
    }
    function cleanup() {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
    }
    ws.on('message', onMessage)
    ws.on('close', onClose)
  })
}

const wsPort = await freePort()
let httpPort = await freePort()
if (httpPort === wsPort) httpPort = await freePort()

const serve = spawn(process.execPath, [bin, 'serve', '--lang', 'en', '--ws-port', String(wsPort), '--http-port', String(httpPort)], {
  env: { ...process.env, DSH_HOME: home },
  stdio: 'pipe',
})
serve.stdout.on('data', chunk => {
  if (process.env.DSWRITESYNC_SMOKE_VERBOSE) process.stdout.write(`[serve] ${chunk}`)
})
serve.stderr.on('data', chunk => {
  if (process.env.DSWRITESYNC_SMOKE_VERBOSE) process.stderr.write(`[serve] ${chunk}`)
})

let ws = null
try {
  const bridgeRoot = join(home, 'writing-desk', 'bridge')
  const authFile = join(bridgeRoot, 'auth.json')
  const auth = await waitFor(async () => {
    try {
      return JSON.parse(await readFile(authFile, 'utf8'))
    } catch {
      return null
    }
  }, 15000)
  check('serve 写出 auth.json', Boolean(auth), authFile)
  check('auth.json 含 v/token/wsPort/httpPort/pid/startedAt',
    auth.v === 1
      && typeof auth.token === 'string' && auth.token.length > 0
      && auth.wsPort === wsPort
      && auth.httpPort === httpPort
      && Number.isInteger(auth.pid)
      && typeof auth.startedAt === 'string')

  // 1) 错误 token：hello 后被 close 4003
  const badWs = await connect(wsPort)
  const badClosed = new Promise(resolve => badWs.once('close', code => resolve(code)))
  badWs.send(JSON.stringify({ kind: 'hello', token: 'definitely-wrong', version: 1, lang: 'en' }))
  const badCode = await Promise.race([badClosed, wait(4000).then(() => 'timeout')])
  check('错误 token 被 close 4003', badCode === 4003, String(badCode))
  try { badWs.close() } catch { /* noop */ }

  // 2) 正确 hello
  ws = await connect(wsPort)
  const helloP = nextMessage(ws, message => message.kind === 'hello-ok')
  ws.send(JSON.stringify({ kind: 'hello', token: auth.token, version: 1, lang: 'en' }))
  const hello = await helloP
  check('hello 收到 hello-ok', hello.kind === 'hello-ok' && hello.version === 1)

  // 3) CLI secondary（platforms）经 HTTP 转发到 primary，再转给扩展
  let platformRequest = null
  ws.on('message', raw => {
    let message
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.method === 'listPlatforms') {
      platformRequest = message
      ws.send(JSON.stringify({
        id: message.id,
        result: [{ id: 'zhihu', name: '知乎', homepage: 'https://www.zhihu.com', isAuthenticated: true }],
      }))
    }
  })

  const secondary = spawn(process.execPath, [bin, '--lang', 'en', 'platforms'], {
    env: {
      ...process.env,
      DSH_HOME: home,
      SYNC_WS_PORT: String(wsPort),
      SYNC_HTTP_PORT: String(httpPort),
    },
    stdio: 'pipe',
  })
  let secondaryOut = ''
  secondary.stdout.on('data', chunk => { secondaryOut += chunk })
  secondary.stderr.on('data', chunk => { secondaryOut += chunk })
  const secondaryExit = await Promise.race([
    new Promise(resolve => secondary.once('exit', code => resolve(code))),
    wait(20000).then(() => 'timeout'),
  ])
  if (secondaryExit === 'timeout') secondary.kill()
  check('CLI secondary 通过 HTTP 转发请求',
    Boolean(platformRequest) && secondaryOut.includes('zhihu'),
    secondaryExit === 'timeout' ? 'timeout' : `exit ${secondaryExit}`)

  // sync 同样走 secondary 转发
  let syncRequest = null
  let bigSyncRequest = null
  ws.on('message', raw => {
    let message
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.method === 'syncArticle') {
      syncRequest = message
      if (message.params?.article?.title === '大图冒烟') bigSyncRequest = message
      ws.send(JSON.stringify({
        id: message.id,
        result: {
          results: [
            { platform: 'zhihu', success: true, postUrl: 'https://example.com/draft/1', draftOnly: true },
            { platform: 'juejin', success: false, error: 'not logged in' },
          ],
        },
      }))
    }
  })

  const articleFile = join(home, 'article.md')
  await writeFile(articleFile, '# Secondary sync\n\n正文\n')
  const secondarySync = spawn(process.execPath, [bin, '--lang', 'en', 'sync', articleFile, '-p', 'zhihu,juejin'], {
    env: {
      ...process.env,
      DSH_HOME: home,
      SYNC_WS_PORT: String(wsPort),
      SYNC_HTTP_PORT: String(httpPort),
    },
    stdio: 'pipe',
  })
  let syncOut = ''
  secondarySync.stdout.on('data', chunk => { syncOut += chunk })
  secondarySync.stderr.on('data', chunk => { syncOut += chunk })
  const secondarySyncExit = await Promise.race([
    new Promise(resolve => secondarySync.once('exit', code => resolve(code))),
    wait(20000).then(() => 'timeout'),
  ])
  if (secondarySyncExit === 'timeout') secondarySync.kill()
  check('CLI sync 作为 secondary 通过 HTTP 转发',
    secondarySyncExit === 0 && syncOut.includes('zhihu') && Boolean(syncRequest),
    secondarySyncExit === 'timeout' ? 'timeout' : `exit ${secondarySyncExit}`)

  // 4) desk.capture 落 inbox + ack
  const captureId = 'cap-smoke-1'
  const captureOp = 'smoke-capture-1'
  const ackP = nextMessage(ws, message => message.kind === 'ack' && message.id === captureId)
  ws.send(JSON.stringify({
    kind: 'event',
    event: 'desk.capture',
    id: captureId,
    payload: {
      operationId: captureOp,
      url: 'https://example.com/post/1',
      title: '冒烟文章',
      body: '正文内容',
      siteName: 'Example',
      tags: ['smoke'],
    },
  }))
  const ack = await ackP
  check('desk.capture 收到 ack', ack.ok === true && ack.operationId === captureOp && ack.queued === true)
  const inboxFile = join(bridgeRoot, 'inbox', `import-${captureOp}.json`)
  const inbox = await waitFor(async () => {
    try {
      return JSON.parse(await readFile(inboxFile, 'utf8'))
    } catch {
      return null
    }
  })
  check('desk.capture 原子写入 inbox', inbox?.url === 'https://example.com/post/1' && inbox?.operationId === captureOp)

  // 4) 宿主回执 → desk.capture-result
  await mkdir(join(bridgeRoot, 'receipts'), { recursive: true })
  const resultP = nextMessage(ws, message => message.kind === 'event'
    && message.event === 'desk.capture-result'
    && message.payload?.operationId === captureOp, 12000)
  await writeFile(join(bridgeRoot, 'receipts', `import-${captureOp}.json`), JSON.stringify({
    ok: true,
    operationId: captureOp,
    itemId: 'it_smoke',
  }))
  const captureResult = await resultP
  check('import 回执后推送 capture-result', captureResult.payload?.ok === true && captureResult.payload?.itemId === 'it_smoke')

  // 5) catalog-request → 空表
  const catalogP = nextMessage(ws, message => message.kind === 'event' && message.event === 'desk.catalog' && message.id === 'cat-1')
  ws.send(JSON.stringify({ kind: 'event', event: 'desk.catalog-request', id: 'cat-1' }))
  const catalog = await catalogP
  check('desk.catalog-request 回空表', Array.isArray(catalog.payload?.tags) && catalog.payload.tags.length === 0
    && catalog.payload?.urls && Object.keys(catalog.payload.urls).length === 0)

  // 6) HTTP /request 无 token 401
  const noAuth = await fetch(`http://127.0.0.1:${httpPort}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'listPlatforms' }),
  })
  check('HTTP /request 无 token 返回 401', noAuth.status === 401, String(noAuth.status))

  const withBearer = await fetch(`http://127.0.0.1:${httpPort}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ method: 'listPlatforms' }),
  })
  const withBearerBody = await withBearer.json()
  check('HTTP /request Bearer token 生效',
    withBearer.status === 200 && withBearerBody.result?.[0]?.id === 'zhihu',
    String(withBearer.status))

  const withBodyToken = await fetch(`http://127.0.0.1:${httpPort}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'listPlatforms', token: auth.token }),
  })
  check('HTTP /request body token 生效', withBodyToken.status === 200, String(withBodyToken.status))

  // 7) outbox 任务 → syncArticle → dispatch 回执
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzY9WQAAAABJRU5ErkJggg==', 'base64')
  const exportDir = join(home, 'export')
  const imageDir = join(exportDir, 'images')
  await mkdir(imageDir, { recursive: true })
  const imageFile = join(imageDir, 'p.png')
  await writeFile(imageFile, pixel)

  const dispatchOp = 'smoke-dispatch-1'
  const outboxDir = join(bridgeRoot, 'outbox')
  await mkdir(outboxDir, { recursive: true })
  const taskFile = join(outboxDir, `publish-${dispatchOp}.json`)
  const task = {
    kind: 'publish',
    operationId: dispatchOp,
    itemId: 'it_dispatch',
    title: '投递冒烟',
    articleMd: '# 投递冒烟\n\n正文\n\n![图](images/p.png)\n',
    images: { 'images/p.png': imageFile },
    platforms: ['zhihu', 'juejin'],
  }
  await writeFile(`${taskFile}.tmp`, JSON.stringify(task))
  await rename(`${taskFile}.tmp`, taskFile)

  const receiptFile = join(bridgeRoot, 'receipts', `dispatch-${dispatchOp}.json`)
  const receipt = await waitFor(async () => {
    try {
      return JSON.parse(await readFile(receiptFile, 'utf8'))
    } catch {
      return null
    }
  }, 15000)
  check('outbox 任务生成 dispatch 回执', receipt.operationId === dispatchOp && receipt.itemId === 'it_dispatch')
  const byPlatform = Object.fromEntries((receipt.results ?? []).map(row => [row.platform, row]))
  check('回执映射 success/postUrl/error',
    byPlatform.zhihu?.ok === true
      && byPlatform.zhihu?.url === 'https://example.com/draft/1'
      && byPlatform.juejin?.ok === false
      && byPlatform.juejin?.error === 'not logged in',
    JSON.stringify(receipt.results))
  check('syncArticle 收到 data URI 与非逐条 token',
    Boolean(syncRequest)
      && syncRequest.params.platforms.join(',') === 'zhihu,juejin'
      && syncRequest.params.article.markdown.includes('data:image/png;base64,')
      && !syncRequest.params.article.markdown.includes('images/p.png')
      && syncRequest.token === undefined)
  check('任务文件已清理',
    !existsSync(taskFile) && !existsSync(`${taskFile}.claiming`))

  // 8) 大图走分片上传（>1MB base64），替换成图床 URL 而不是 data URI
  let imageUploaded = false
  ws.on('message', raw => {
    let message
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (typeof message.method !== 'string' || !message.method.startsWith('uploadImage')) return
    if (message.method === 'uploadImage:complete') {
      imageUploaded = true
      ws.send(JSON.stringify({ id: message.id, result: { url: 'https://img.example/big.png', platform: 'zhihu' } }))
    } else {
      ws.send(JSON.stringify({ id: message.id, result: { success: true } }))
    }
  })

  const bigFile = join(imageDir, 'big.png')
  await writeFile(bigFile, Buffer.alloc(1100 * 1024, 7))
  const bigOp = 'smoke-dispatch-2'
  const bigTaskFile = join(outboxDir, `publish-${bigOp}.json`)
  await writeFile(`${bigTaskFile}.tmp`, JSON.stringify({
    kind: 'publish',
    operationId: bigOp,
    itemId: 'it_dispatch_big',
    title: '大图冒烟',
    articleMd: '# 大图冒烟\n\n![大图](images/big.png)\n',
    images: { 'images/big.png': bigFile },
    platforms: ['zhihu'],
  }))
  await rename(`${bigTaskFile}.tmp`, bigTaskFile)

  const bigReceiptFile = join(bridgeRoot, 'receipts', `dispatch-${bigOp}.json`)
  const bigReceipt = await waitFor(async () => {
    try {
      return JSON.parse(await readFile(bigReceiptFile, 'utf8'))
    } catch {
      return null
    }
  }, 30000)
  check('大图分片上传并写回执',
    imageUploaded
      && bigReceipt.results?.[0]?.platform === 'zhihu'
      && bigReceipt.results?.[0]?.ok === true
      && Boolean(bigSyncRequest)
      && bigSyncRequest.params.article.markdown.includes('https://img.example/big.png')
      && !bigSyncRequest.params.article.markdown.includes('images/big.png'),
    imageUploaded ? 'uploaded' : 'not uploaded')

  // 9) 端口占用 fail-fast（另一个 serve 起不来）
  const second = spawn(process.execPath, [bin, 'serve', '--lang', 'en', '--ws-port', String(wsPort), '--http-port', String(httpPort)], {
    env: { ...process.env, DSH_HOME: home },
    stdio: 'pipe',
  })
  const secondExit = await new Promise(resolve => second.once('exit', code => resolve(code)))
  check('端口被占时 serve 报错退出', secondExit !== 0, String(secondExit))
} catch (error) {
  check('冒烟脚本无异常', false, String(error?.stack || error))
} finally {
  try { ws?.close() } catch { /* noop */ }
  serve.kill()
  await wait(300)
}

const failed = results.filter(row => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)