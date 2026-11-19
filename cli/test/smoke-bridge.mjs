// 桥全链路冒烟:起 serve → 扩展角色握手 → capture 投递 → 结果校验。
// 宿主不在时 capture 超时,返回 exit 2 属预期;本脚本用真 host 消化路径测不了
// (需要 DSH 起着),所以只验桥自身:握手、非法 token 拒绝、HTTP /status 鉴权。
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const home = mkdtempSync(join(tmpdir(), 'wdesk-smoke-'))
process.env.DSH_HOME = home
const bin = fileURLToPath(new URL('../bin/wdesk.js', import.meta.url))
const serve = spawn(process.execPath, [bin, 'serve'], { env: process.env, stdio: 'pipe' })
serve.stderr.on('data', d => process.stderr.write(`[serve] ${d}`))
serve.stdout.on('data', d => process.stdout.write(`[serve] ${d}`))
const wait = ms => new Promise(r => setTimeout(r, ms))

let auth = null
for (let i = 0; i < 40 && !auth; i += 1) {
  await wait(250)
  try {
    auth = JSON.parse(readFileSync(join(home, 'writing-desk/bridge/auth.json'), 'utf8'))
  } catch { /* 还没写出来 */ }
}
if (!auth) {
  console.error('serve 没能写出 auth.json')
  serve.kill()
  process.exit(1)
}
const results = []
const check = (name, ok) => results.push({ name, ok })

// 1. 正确 token 握手
const ws = new WebSocket(`ws://127.0.0.1:${auth.wsPort}`)
const welcome = await new Promise((resolve, reject) => {
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', v: 1, client: 'extension', token: auth.token }))
  ws.onmessage = e => resolve(JSON.parse(e.data))
  setTimeout(() => reject(new Error('握手超时')), 5000)
})
check('正确 token 握手收到 welcome', welcome.type === 'welcome')

// 2. capture 请求被接受并进入 inbox(宿主没起,回执会超时——这里只验桥写投递)
const captureP = new Promise(resolve => {
  ws.onmessage = e => resolve(JSON.parse(e.data))
})
ws.send(JSON.stringify({ type: 'request', id: 'c1', method: 'capture', params: { operationId: 'smoke-0001', url: 'https://example.com/x', title: '冒烟' } }))
const inboxFile = join(home, 'writing-desk/bridge/inbox/import-smoke-0001.json')
await wait(600)
check('capture 落进 inbox', (() => { try { return JSON.parse(readFileSync(inboxFile, 'utf8')).url === 'https://example.com/x' } catch { return false } })())

// 3. HTTP /status 无 token 401,有 token 200
const noAuth = await fetch(`http://127.0.0.1:${auth.httpPort}/status`)
const withAuth = await fetch(`http://127.0.0.1:${auth.httpPort}/status`, { headers: { authorization: `Bearer ${auth.token}` } })
check('HTTP /status 无 token 401', noAuth.status === 401)
check('HTTP /status 有 token 200', withAuth.status === 200)

// 4. 错误 token 被断开
const badWs = new WebSocket(`ws://127.0.0.1:${auth.wsPort}`)
const closed = await new Promise(resolve => {
  badWs.onopen = () => badWs.send(JSON.stringify({ type: 'hello', v: 1, client: 'extension', token: 'wrong' }))
  badWs.onclose = () => resolve(true)
  setTimeout(() => resolve(false), 4000)
})
check('错误 token 握手被断开', closed)

serve.kill()
await wait(300)
for (const { name, ok } of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
process.exit(results.every(r => r.ok) ? 0 : 1)
