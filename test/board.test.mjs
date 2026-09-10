// dsh-my-go — board 存储层直测（第一期步骤 1.1，shared 纯模块脱离 mock-ctx）。
//
// 覆盖（规划 1.1 验收 + D1 已裁决语义）：
//   原子写（tmp 残骸清理、覆盖写 + .prev.md 留痕、失败 rethrow）/ 行切片边界矩阵（offset=0、
//   超尾、limit 超总长、limit=0、负数、NaN/缺省、空文件、无尾换行）/
//   段名注入探针（'../x'、'a/b'、'..'、Windows 盘符——变异探针约定：去掉
//   boardPath 的 encodeSegment，相对穿越探针用例必红，已实测后恢复）。
//
// 隔离：boardRoot() 每次现读 process.env.DSH_HOME，用例统一经 withBoardHome
// 换入独立临时目录；node --test 文件间进程隔离、文件内串行，env 还原在 finally。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { boardRoot, writeBoard, readBoardSlice, hasBoardEntry } from '../preset/shared/board.mjs'
import { encodeSegment } from '../preset/shared/archive.mjs'
import { removeHomeWithRetry } from './helpers/mock-ctx.mjs'

async function withBoardHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-my-go-board-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await fn(home)
  } finally {
    process.env.DSH_HOME = prev
    await removeHomeWithRetry(home)
  }
}

// 路径形状锁（双保险断言）：返回的绝对路径必须 ① 仍在 board 根目录之内、
// ② 会话目录段恰好是 encodeSegment(sessionId)、③ 文件名恰好是
// encodeSegment(childId) + '.md'。②③ 让「只删掉任意一侧 encodeSegment」的
// 变异都当场红（childId 侧有 '.md' 后缀救场：'..' 裸拼成 '...md' 不逃根、
// '../x' 只逃会话目录——单靠 ① 咬不住，防线会漏）。
function assertBoardPathShape(path, sessionId, childId, what) {
  const root = resolve(boardRoot())
  const resolved = resolve(path)
  assert.ok(
    resolved.startsWith(root + sep),
    `${what} 逃出了焊死的 board 根: ${resolved} (root: ${root})`,
  )
  const rel = resolved.slice(root.length + sep.length)
  const parts = rel.split(sep)
  assert.equal(parts.length, 2, `${what} 应为「会话目录/文件」两层: ${rel}`)
  assert.equal(parts[0], encodeSegment(sessionId), `${what} 会话段未过 encodeSegment: ${parts[0]}`)
  assert.equal(parts[1], `${encodeSegment(childId)}.md`, `${what} 文件名未过 encodeSegment: ${parts[1]}`)
}

// ── 路径与写入 ───────────────────────────────────────────────────────────────

test('boardRoot：DSH_HOME 惯例路径（台账同款）', async () => {
  await withBoardHome((home) => {
    assert.equal(boardRoot(), join(home, 'dsh-my-go', 'board'))
  })
})

test('writeBoard 原子写：内容落盘、bytes 为 UTF-8 真实字节、目录无 .tmp 残骸', async () => {
  await withBoardHome(async () => {
    const content = '# 结论\n中文报告正文，多字节计数。\n<open>无</open>\n'
    const { path, bytes } = await writeBoard('sess-w1', 'child-w1', content)
    assertBoardPathShape(path, 'sess-w1', 'child-w1', 'writeBoard 返回路径')
    assert.ok(path.endsWith('.md'), 'board 文件扩展名 .md')
    assert.equal(bytes, Buffer.byteLength(content, 'utf-8'), 'bytes = UTF-8 真实字节数（容量观测原料）')
    assert.equal(await import('node:fs/promises').then((m) => m.readFile(path, 'utf-8')), content)
    const sessionDir = resolve(path, '..')
    assert.deepEqual(
      readdirSync(sessionDir).filter((f) => f !== 'child-w1.md'),
      [],
      `落盘目录里只剩正主文件（tmp 已 rename，无残骸）: ${readdirSync(sessionDir).join(', ')}`,
    )
  })
})

test('writeBoard 覆盖写：同 (sessionId, childId) 重写即替换', async () => {
  await withBoardHome(async () => {
    await writeBoard('sess-w2', 'child-w2', 'old report')
    const { bytes } = await writeBoard('sess-w2', 'child-w2', 'new report\nline2')
    const reread = await readBoardSlice('sess-w2', 'child-w2')
    assert.equal(reread.text, 'new report\nline2', '覆盖写后读回新内容')
    assert.equal(reread.totalLines, 2)
    assert.equal(bytes, Buffer.byteLength('new report\nline2', 'utf-8'))
  })
})

// 报告板覆盖卫生（顺手项A）：覆盖不再让上一版无声蒸发（取证现场：一次落板把
// 4993B 原文压成 777B 摘要，无从对照）。留痕只保最近一版，且刻意对读侧隐形——
// hasBoardEntry 也只认正板，否则 .prev 会让闸门永久放行、把「板为准」变成「板
// 上任何历史痕迹为准」。
test('writeBoard 覆盖留痕：旧板改名 <childId>.prev.md，只保最近一版，且不进任何读路径', async () => {
  await withBoardHome(async () => {
    const dir = join(boardRoot(), 'sess-pv')
    await writeBoard('sess-pv', 'child-pv', '第一版原文')
    await writeBoard('sess-pv', 'child-pv', '第二版原文')
    assert.equal((await readBoardSlice('sess-pv', 'child-pv')).text, '第二版原文', '正板恒为最新一版')
    assert.equal(readFileSync(join(dir, 'child-pv.prev.md'), 'utf-8'), '第一版原文', '被顶掉的旧板让位到 .prev.md')
    await writeBoard('sess-pv', 'child-pv', '第三版原文')
    assert.equal(readFileSync(join(dir, 'child-pv.prev.md'), 'utf-8'), '第二版原文', '同名 .prev 直接覆盖：只留最近一版')
    assert.deepEqual(
      readdirSync(dir).filter((f) => !f.startsWith('child-pv')).sort(),
      [],
      '目录里不产生第三种留痕形态',
    )
    assert.equal(readdirSync(dir).sort().join(','), 'child-pv.md,child-pv.prev.md')
    assert.equal(hasBoardEntry('sess-pv', 'child-pv'), true, '正板在 → 有货')
    assert.equal(hasBoardEntry('sess-pv', 'child-pv.md'), false, '段名不同形即不同键（.prev 不被误认成正板）')
    rmSync(join(dir, 'child-pv.md'), { force: true })
    assert.equal(hasBoardEntry('sess-pv', 'child-pv'), false, '正板摘除后只剩 .prev：判无货（留痕不参与闸门兜底）')
    assert.equal(hasBoardEntry('sess-pv', 'child-absent'), false, '缺席即 false，不抛出')
  })
})

test('writeBoard 失败语义：业务存储 fail-fast——抛错且不留 .tmp 残骸', async () => {
  await withBoardHome(async () => {
    // 造 rename 必败：目标 .md 路径被一个非空目录占住（writeFile 到 tmp 可成功，
    // rename 文件→非空目录在 Windows/POSIX 都失败）→ catch 清残骸后 rethrow。
    const sessDir = join(boardRoot(), 'sess-f1')
    mkdirSync(sessDir, { recursive: true })
    const occupied = join(sessDir, 'child-f1.md')
    mkdirSync(occupied)
    writeFileSync(join(occupied, 'blocker'), 'not a file', 'utf-8')
    await assert.rejects(
      () => writeBoard('sess-f1', 'child-f1', 'boom'),
      undefined,
      '落板失败必须抛给调用方处置（业务数据不静默吞）',
    )
    assert.deepEqual(
      readdirSync(sessDir).filter((f) => f !== 'child-f1.md'),
      [],
      '失败后 tmp 残骸已被清理',
    )
  })
})

test('writeBoard：非 string content 抛 TypeError；空段名抛错（encodeSegment 语义）', async () => {
  await withBoardHome(async () => {
    await assert.rejects(() => writeBoard('s', 'c', 123), TypeError)
    await assert.rejects(() => writeBoard('s', 'c', null), TypeError)
    await assert.rejects(() => writeBoard('', 'c', 'x'), /empty path segment/)
    await assert.rejects(() => writeBoard('s', '', 'x'), /empty path segment/)
  })
})

// ── 行切片（D1：按行计量、越界钳制、回显实际生效值）─────────────────────────

test('round-trip：多行中文/空行全文写入后全量读回逐字节一致', async () => {
  await withBoardHome(async () => {
    const content = '# 完整报告\n第一段\n\n第三段（上面是空行）\n中文·标点·emoji 词——都算字节\n收尾行\n'
    await writeBoard('sess-r1', 'child-r1', content)
    const full = await readBoardSlice('sess-r1', 'child-r1')
    assert.equal(full.error, undefined)
    assert.equal(full.totalLines, 6)
    assert.equal(full.offset, 0, '缺省 offset = 0（0-based 跳过行数）')
    assert.equal(full.limit, 6, '缺省 limit = 读到底（回显实际生效行数）')
    assert.equal(full.text, content.slice(0, -1), '全量切片 = 去掉尾随换行的全部行 join')
  })
})

test('切片边界矩阵：offset/limit 越界一律钳制并回显实际生效值', async () => {
  await withBoardHome(async () => {
    const content = ['l0', 'l1', 'l2', 'l3', 'l4'].join('\n') + '\n'
    await writeBoard('sess-s1', 'child-s1', content)
    const cases = [
      [{ offset: 0, limit: 2 }, { offset: 0, limit: 2, text: 'l0\nl1' }, 'offset=0 正常头切片'],
      [{ offset: 2, limit: 2 }, { offset: 2, limit: 2, text: 'l2\nl3' }, '中段切片'],
      [{ offset: 3, limit: 99 }, { offset: 3, limit: 2, text: 'l3\nl4' }, 'limit 超总长钳到尾'],
      [{ offset: 5, limit: 3 }, { offset: 5, limit: 0, text: '' }, 'offset 超尾钳到 totalLines（空切片）'],
      [{ offset: 0, limit: 0 }, { offset: 0, limit: 0, text: '' }, 'limit=0 = 空切片'],
      [{ offset: -7, limit: -3 }, { offset: 0, limit: 0, text: '' }, '负数钳 0'],
      [{ offset: Number.NaN, limit: Number.NaN }, { offset: 0, limit: 5, text: 'l0\nl1\nl2\nl3\nl4' }, 'NaN 按缺省（offset=0 / limit 不限）'],
      [{ offset: 1.9, limit: 2.9 }, { offset: 1, limit: 2, text: 'l1\nl2' }, '非整数截断'],
    ]
    for (const [args, expected, why] of cases) {
      const got = await readBoardSlice('sess-s1', 'child-s1', args.offset, args.limit)
      assert.deepEqual({ offset: got.offset, limit: got.limit, text: got.text }, expected, why)
      assert.equal(got.totalLines, 5, `${why} — totalLines 恒预告全量行数`)
    }
  })
})

test('空文件与无尾换行：totalLines 口径（尾随换行不计、末行无换行仍计）', async () => {
  await withBoardHome(async () => {
    await writeBoard('sess-e1', 'child-e1', '')
    const empty = await readBoardSlice('sess-e1', 'child-e1')
    assert.deepEqual(empty, { totalLines: 0, offset: 0, limit: 0, text: '' }, '空文件 0 行、空切片')
    const p = join(boardRoot(), 'sess-e1', 'no-trailing.md')
    mkdirSync(join(boardRoot(), 'sess-e1'), { recursive: true })
    writeFileSync(p, 'line1\nline2', 'utf-8')
    const noTrailing = await readBoardSlice('sess-e1', 'no-trailing')
    assert.equal(noTrailing.totalLines, 2, '末行无换行符仍计一行')
    assert.equal(noTrailing.text, 'line1\nline2')
  })
})

test('readBoardSlice：文件缺席返回明确错误对象而非抛出', async () => {
  await withBoardHome(async () => {
    const got = await readBoardSlice('sess-absent', 'child-absent', 0, 10)
    assert.equal(got.error, 'not-found', '缺席 → error 对象（调用方判 error 字段）')
    assert.ok(got.path.endsWith(join('sess-absent', 'child-absent.md')), '错误对象携带解析后的目标路径')
    assert.equal(got.totalLines, undefined, '缺席时无切片字段（与成功形状可区分）')
  })
})

// ── 段名注入探针 ─────────────────────────────────────────────────────────────
// 变异探针约定（规划 1.1 验收）：去掉 boardPath 里的 encodeSegment（把编码段
// 换成裸段），下面「相对穿越」用例必红——'..' 会作为真实路径段逃出焊死的根。
// 相对穿越与 Windows 盘符拆成两个用例：变异态下只实测前者（盘符裸段在变异态
// 会让 join 重置到真实盘根，变异期间不跑它）。

test('段名注入探针（相对穿越）：../x、a/b、.. 编码后恒焊死在 board 根内', async () => {
  await withBoardHome(async () => {
    for (const evil of ['..', '../x', 'a/b']) {
      const { path } = await writeBoard('sess-ok', evil, 'safe-content')
      assertBoardPathShape(path, 'sess-ok', evil, `childId=${JSON.stringify(evil)}`)
      const reread = await readBoardSlice('sess-ok', evil)
      assert.equal(reread.text, 'safe-content', `同编码往返可读: ${evil}`)
    }
    const { path } = await writeBoard('../evil-sid', 'child-ok', 'safe-content')
    assertBoardPathShape(path, '../evil-sid', 'child-ok', "sessionId='../evil-sid'")
  })
})

test('段名注入探针（Windows 盘符）：C:\\x 作段不产生盘符逃逸', async () => {
  await withBoardHome(async () => {
    const a = await writeBoard('C:\\x', 'child-drive', 'safe-content')
    assertBoardPathShape(a.path, 'C:\\x', 'child-drive', "sessionId='C:\\x'")
    const b = await writeBoard('sess-ok', 'C:\\x', 'safe-content')
    assertBoardPathShape(b.path, 'sess-ok', 'C:\\x', "childId='C:\\x'")
    assert.equal((await readBoardSlice('C:\\x', 'child-drive')).text, 'safe-content')
    assert.equal((await readBoardSlice('sess-ok', 'C:\\x')).text, 'safe-content')
  })
})
