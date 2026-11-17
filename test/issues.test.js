// GitHub issue 回归:#16 再次保存不冲掉文件夹里手改的稿子。
// 生图网关(#3)与会话标识(#4)随内置流水线退役(ADR 0006),回归保护随之取消。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { saveProduction } from '../src/export.js'

test('#16 再次保存不冲掉文件夹里手改的稿子，标题相同的两篇各存各的', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-issue16-'))
  try {
    const first = { title: '同一个标题', article: '# 同一个标题\n\n第一版正文' }
    const options = { filesDir: dir, exportDir: join(dir, 'out') }
    const saved = await saveProduction(first, options)
    assert.equal(saved.path, join(dir, 'out', '同一个标题'))
    assert.match(await readFile(join(saved.path, '文章.md'), 'utf8'), /第一版正文/)
    first.savedPath = saved.path
    first.savedHashes = saved.hashes

    // 用户在文件夹里改了稿子:保存时先另存一份手改备份,再写新内容
    const second = { ...first, article: '# 同一个标题\n\n第三版正文' }
    await writeFile(join(saved.path, '文章.md'), '我在文件夹里手改过的')
    const again = await saveProduction(second, options)
    assert.equal(again.backups.length, 1)
    assert.match(await readFile(join(saved.path, '文章.md'), 'utf8'), /第三版/)
    second.savedPath = again.path
    second.savedHashes = again.hashes

    // 手改的内容和要写的一样,不用备份
    const same = await saveProduction({ ...second, savedHashes: {} }, options)
    assert.deepEqual(same.backups, [])

    // 2.7.0 及以前保存的没有指纹,分不清是谁改的,稳妥起见也留一份
    await writeFile(join(saved.path, '文章.md'), '老版本存的')
    assert.equal((await saveProduction({ ...second, savedHashes: undefined }, options)).backups.length, 1)

    // 标题相同的另一篇存到新文件夹,各存各的
    const other = await saveProduction({ title: '同一个标题', article: '另一篇。' }, options)
    assert.equal(other.path, join(dir, 'out', '同一个标题 2'))
    assert.match(await readFile(join(saved.path, '文章.md'), 'utf8'), /第三版/)
    assert.equal((await saveProduction({ title: '同一个标题', article: '第三篇。' }, options)).path, join(dir, 'out', '同一个标题 3'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
