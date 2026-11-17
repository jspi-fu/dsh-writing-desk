// GitHub issue 回归：#3 生图网关返回相对路径，#4 会话外调用缺少会话标识。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callModel, PLUGIN_SESSION_ID } from '../src/ai.js'
import { generateImage, imageUrlCandidates } from '../src/images.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const GATEWAY = { baseUrl: 'http://gw.test:11435/qwenimage/v1', model: 'Qwen-Image-2.1', apiKey: 'secret-key-1234', size: '', quality: '', extra: '{"output_format":"png"}' }

test('#3 图片地址候选：保留挂载前缀，已带前缀和完整链接原样用，危险协议不要', () => {
  assert.deepEqual(imageUrlCandidates('/v1/images/x/content', GATEWAY.baseUrl), [
    'http://gw.test:11435/qwenimage/v1/images/x/content',
    'http://gw.test:11435/qwenimage/v1/v1/images/x/content',
    'http://gw.test:11435/v1/images/x/content',
  ])
  assert.deepEqual(imageUrlCandidates('/qwenimage/v1/images/x/content', GATEWAY.baseUrl), ['http://gw.test:11435/qwenimage/v1/images/x/content'])
  assert.deepEqual(imageUrlCandidates('/v1/images/x', 'https://api.example/v1'), ['https://api.example/v1/images/x'])
  assert.deepEqual(imageUrlCandidates('https://cdn.example/a.png', GATEWAY.baseUrl), ['https://cdn.example/a.png'])
  assert.deepEqual(imageUrlCandidates('javascript:alert(1)', GATEWAY.baseUrl), [])
  assert.deepEqual(imageUrlCandidates('', GATEWAY.baseUrl), [])
})

test('#3 网关返回 b64_json: null 和相对 url：跳过 404 的拼法，下到图，不重画', async () => {
  const seen = []
  const gateway = async (url, init) => {
    const href = String(url)
    seen.push([init?.method ?? 'GET', href, init?.headers?.authorization])
    if (href.endsWith('/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: null, url: '/v1/images/abc/content', file_path: '/srv/abc.png' }] }))
    if (href === 'http://gw.test:11435/qwenimage/v1/images/abc/content') return new Response(PNG)
    return new Response('not found', { status: 404 })
  }
  const result = await generateImage(GATEWAY, 'a paper boat', { fetchImpl: gateway })
  assert.equal(result.ext, '.png')
  assert.equal(seen.filter(([method]) => method === 'POST').length, 1)
  // 同源下载带上用户填的密钥
  assert.deepEqual(seen[1], ['GET', 'http://gw.test:11435/qwenimage/v1/images/abc/content', 'Bearer secret-key-1234'])
})

test('#3 地址确定拿不到时不重画，也不说成「连不上生图服务」', async () => {
  let posts = 0
  const missing = async (url) => {
    if (String(url).endsWith('/images/generations')) {
      posts += 1
      return new Response(JSON.stringify({ data: [{ b64_json: null, url: '/v1/images/abc/content' }] }))
    }
    return new Response('', { status: 404 })
  }
  await assert.rejects(generateImage(GATEWAY, 'p', { fetchImpl: missing }), err => /下载图片失败（404）/.test(err.message) && !/连不上/.test(err.message))
  assert.equal(posts, 1)

  posts = 0
  const garbage = async () => {
    posts += 1
    return new Response(JSON.stringify({ data: [{ url: 'http://' }] }))
  }
  await assert.rejects(generateImage(GATEWAY, 'p', { fetchImpl: garbage }), err => !/连不上/.test(err.message))
  assert.equal(posts, 1)

  const onlyPath = async () => new Response(JSON.stringify({ data: [{ b64_json: null, url: null, file_path: '/srv/abc.png' }] }))
  await assert.rejects(generateImage(GATEWAY, 'p', { fetchImpl: onlyPath }), /本机的文件路径/)
})

test('#3 别的域名的下载地址照样拦内网', async () => {
  const internal = async (url) => (String(url).endsWith('/images/generations')
    ? new Response(JSON.stringify({ data: [{ url: 'http://127.0.0.1/x.png' }] }))
    : new Response(PNG))
  await assert.rejects(generateImage(GATEWAY, 'p', { fetchImpl: internal }), /本机|内网/)
})

test('#4 模型调用带上会话标识，供 opencode-go 这类按会话路由的网关使用', async () => {
  const requests = []
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }) }
      if (name === 'llm') {
        return {
          prepareCall: async () => ({
            config: {},
            async* stream(request) {
              requests.push(request)
              yield { type: 'text-delta', text: 'ok' }
            },
          }),
        }
      }
      return undefined
    },
  }
  await callModel(ctx, { system: 's', user: 'u' })
  await callModel(ctx, { system: 's', user: 'u' })
  await callModel(ctx, { system: 's', user: 'u', sessionId: 'custom' })
  assert.match(PLUGIN_SESSION_ID, /^dsh-writing-desk-[\da-f-]{36}$/)
  assert.deepEqual(requests.map(row => row.sessionId), [PLUGIN_SESSION_ID, PLUGIN_SESSION_ID, 'custom'])
})

test('#4 成稿跟随 DeepSeek Harness 默认模型', async () => {
  const { modelInfo } = await import('../src/ai.js')
  const ctx = { get: name => (name === 'llm' ? {} : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) } : undefined) }
  assert.deepEqual(modelInfo(ctx), { provider: 'deepseek', model: 'deepseek-chat', label: 'deepseek-chat' })
})

test('#16 再次保存不冲掉文件夹里手改的稿子，标题相同的两篇各存各的', async () => {
  const { saveProduction } = await import('../src/export.js')
  const { mkdtemp, readdir, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-issue16-'))
  try {
    const options = { filesDir: join(dir, 'files'), exportDir: join(dir, 'out') }
    const first = { title: '同一个标题', article: '## 开头\n\n第一版。' }
    const saved = await saveProduction(first, options)
    assert.deepEqual(saved.backups, [])
    Object.assign(first, { savedPath: saved.path, savedHashes: saved.hashes })

    // 没在外面改过：直接写新的，不留备份
    first.article = '## 开头\n\n第二版。'
    const again = await saveProduction(first, options)
    assert.equal(again.path, saved.path)
    assert.deepEqual(again.backups, [])
    assert.deepEqual(await readdir(saved.path), ['脚本.md'])
    first.savedHashes = again.hashes

    // 在文件夹里手改过：旧文件另存，新稿照常写入
    await writeFile(join(saved.path, '脚本.md'), '我自己改的一段')
    first.article = '## 开头\n\n第三版。'
    const third = await saveProduction(first, options)
    assert.equal(third.backups.length, 1)
    assert.match(third.backups[0], /^脚本\.手改备份-\d{8}-\d{6}\.md$/)
    assert.equal(await readFile(join(saved.path, third.backups[0]), 'utf8'), '我自己改的一段')
    assert.match(await readFile(join(saved.path, '脚本.md'), 'utf8'), /第三版/)

    // 手改的内容和要写的一样，不用备份
    const same = await saveProduction({ ...first, savedHashes: {} }, options)
    assert.deepEqual(same.backups, [])

    // 2.7.0 及以前保存的没有指纹，分不清是谁改的，稳妥起见也留一份
    await writeFile(join(saved.path, '脚本.md'), '老版本存的')
    assert.equal((await saveProduction({ ...first, savedHashes: undefined }, options)).backups.length, 1)

    // 另一篇标题相同的成稿存到新文件夹
    const other = await saveProduction({ title: '同一个标题', article: '另一篇。' }, options)
    assert.equal(other.path, join(dir, 'out', '同一个标题 2'))
    assert.match(await readFile(join(saved.path, '脚本.md'), 'utf8'), /第三版/)
    assert.equal((await saveProduction({ title: '同一个标题', article: '第三篇。' }, options)).path, join(dir, 'out', '同一个标题 3'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
