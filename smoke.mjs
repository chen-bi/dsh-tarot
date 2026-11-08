/**
 * dsh-tarot 自检：不依赖 DSH 运行时，用最小 mock ctx 跑一遍宿主半侧 + 牌库。
 *
 * 用法：node smoke.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 存档写到临时文件，别碰真实的 ~/.dsh/tarot/history.json
const HISTORY_FILE = path.join(os.tmpdir(), `dsh-tarot-smoke-${process.pid}.json`)
process.env.DSH_TAROT_HISTORY = HISTORY_FILE

const { apply } = await import('./index.js')
const { DECK_SIZE, SPREADS } = await import('./deck.js')

const registered = { tools: [], routes: [], sections: [] }

const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  webServer: {
    register(route) {
      registered.routes.push(route)
      return () => {}
    },
  },
  tools: {
    register(definition) {
      registered.tools.push(definition)
      return () => {}
    },
  },
  systemPrompt: {
    section(section) {
      registered.sections.push(section)
      return () => {}
    },
  },
}

apply(ctx)

// ---- 校验返回值是否符合 OUTPUT_SCHEMA --------------------------------------

function validate(schema, value, path = 'value') {
  if (schema === null || typeof schema !== 'object') return
  const type = schema.type
  if (type === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${path} 应该是对象`)
    const props = schema.properties || {}
    for (const key of Object.keys(value)) {
      if (schema.additionalProperties === false && !Object.hasOwn(props, key)) {
        assert.fail(`${path}.${key} 不在 schema 里`)
      }
    }
    for (const key of schema.required || []) {
      assert.ok(Object.hasOwn(value, key) && value[key] !== undefined, `${path}.${key} 缺失`)
    }
    for (const key of Object.keys(props)) {
      if (Object.hasOwn(value, key)) validate(props[key], value[key], `${path}.${key}`)
    }
    return
  }
  if (type === 'array') {
    assert.ok(Array.isArray(value), `${path} 应该是数组`)
    if (schema.items) for (let i = 0; i < value.length; i += 1) validate(schema.items, value[i], `${path}[${i}]`)
    return
  }
  if (type === 'integer') {
    assert.ok(Number.isInteger(value), `${path} 应该是整数`)
  } else if (type === 'string') {
    assert.ok(typeof value === 'string', `${path} 应该是字符串`)
  } else if (type === 'boolean') {
    assert.ok(typeof value === 'boolean', `${path} 应该是布尔值`)
  }
  if (Array.isArray(schema.enum)) assert.ok(schema.enum.includes(value), `${path} 不在 enum 里`)
}

// ---- mock HTTP ------------------------------------------------------------

function callRoute(query, method = 'GET') {
  return callGet('/api/tarot/state' + query, method)
}

function callGet(pathname, method = 'GET') {
  const req = { url: pathname, method, headers: {} }
  const chunks = []
  let status = 0
  let body = ''
  const res = {
    writeHead(code) {
      status = code
    },
    end(text) {
      body = String(text)
    },
  }
  return registered.routes[0].handler(req, res).then(() => ({ status, body, json: body === '' ? null : JSON.parse(body), chunks }))
}

/** 控制口（POST /api/tarot/control）：给拿不到 tarot 工具的调用方用。 */
function callControl(payload) {
  const text = JSON.stringify(payload)
  let status = 0
  let body = ''
  const req = {
    url: '/api/tarot/control',
    method: 'POST',
    headers: {},
    on(event, fn) {
      if (event === 'data') fn(Buffer.from(text, 'utf8'))
      if (event === 'end') fn()
      return req
    },
    destroy() {},
  }
  const res = {
    writeHead(code) {
      status = code
    },
    end(value) {
      body = String(value)
    },
  }
  return registered.routes[0].handler(req, res).then(() => ({ status, body, json: body === '' ? null : JSON.parse(body) }))
}

const tool = registered.tools[0]
const exec = { agent: { id: 'session-1' } }
const argsOf = (args) => args

function run(args) {
  return tool.execute(argsOf(args), exec)
}

// ---- 断言 ----------------------------------------------------------------

assert.equal(registered.tools.length, 1, '应该注册一个工具')
assert.equal(registered.routes.length, 1, '应该注册一个接口')
assert.equal(registered.sections.length, 1, '应该注册一段系统提示')
assert.equal(tool.name, 'tarot')
assert.equal(tool.parameters.type, 'object', 'parameters 必须是完整 JSON Schema')
assert.equal(registered.routes[0].path, '/api/tarot')

const start = await run({ action: 'start', question: '他还会回来吗', spread: 'three' })
validate(tool.output.schema, start)
assert.equal(start.spread.count, 3)
assert.equal(start.remaining, 3)
assert.deepEqual(start.picked, [])
assert.equal(start.cards.length, 0)
assert.match(start.message, /1–78/)

const before = await callRoute('?session=session-1')
assert.equal(before.status, 200)
assert.equal(before.json.reading.status, 'awaiting')
assert.equal(before.json.reading.slots.length, 3)
assert.equal(before.json.reading.slots[0].card, null)
assert.equal(before.json.reading.deckSize, DECK_SIZE)

// 重复号码要被整批拒绝，且不改状态
await assert.rejects(() => run({ action: 'pick', numbers: [3, 3] }), /已经抽过/)
await assert.rejects(() => run({ action: 'pick', numbers: [0] }), /1–78/)
await assert.rejects(() => run({ action: 'pick', numbers: [79] }), /1–78/)
const still = await callRoute('?session=session-1&since=' + before.json.v)
assert.equal(still.json.unchanged, true, '被拒绝的抽牌不应改变版本号')

const partial = await run({ action: 'pick', numbers: [12, 34] })
validate(tool.output.schema, partial)
assert.equal(partial.remaining, 1)
assert.equal(partial.cards.length, 2)
assert.deepEqual(partial.picked, [12, 34])
assert.match(partial.message, /还差 1 张/)

const picked = await run({ action: 'pick', numbers: [56] })
validate(tool.output.schema, picked)
assert.equal(picked.remaining, 0)
assert.match(picked.message, /抽满/)

const after = await callRoute('?session=session-1')
assert.equal(after.json.reading.status, 'revealed')
assert.equal(after.json.spreads.length, 6, '状态里要带牌阵目录（侧边栏空桌页用）')
assert.ok(after.json.spreads.some((spread) => spread.key === 'love' && spread.count === 5))

// 侧边栏面板没有会话绑定：不带 session 的请求拿到「最近一局」
const latestView = await callRoute('')
assert.ok(latestView.json.reading !== null, '不带 session 时应返回最近一局')
assert.equal(latestView.json.reading.id, after.json.reading.id)
const cards = after.json.reading.slots.map((slot) => slot.card)
assert.equal(cards.length, 3)
for (const card of cards) {
  assert.ok(card.name.length > 0)
  assert.ok(['upright', 'reversed'].includes(card.orientation))
  assert.ok(card.keywords.length > 0)
  assert.ok(card.position.length > 0)
}
assert.deepEqual(after.json.reading.picks, [12, 34, 56])

// 抽满后再抽要报错
await assert.rejects(() => run({ action: 'pick', numbers: [70] }), /抽满/)

// 代抽：新一局
await run({ action: 'start', question: '要不要换工作', spread: 'celtic' })
const draw = await run({ action: 'draw' })
validate(tool.output.schema, draw)
assert.equal(draw.remaining, 0)
assert.equal(draw.cards.length, 10)
assert.equal(new Set(draw.picked).size, 10)

// 自定义牌阵
const custom = await run({ action: 'start', question: '自定义', positions: ['今天', '明天'] })
validate(tool.output.schema, custom)
assert.equal(custom.spread.count, 2)
assert.equal(custom.spread.positions[1].label, '明天')

// status / reset
const status = await run({ action: 'status' })
validate(tool.output.schema, status)
assert.match(status.message, /还差 2 张/)

await run({ action: 'reset' })
const empty = await callRoute('?session=session-1')
assert.equal(empty.json.reading, null)
const statusEmpty = await run({ action: 'status' })
validate(tool.output.schema, statusEmpty)
assert.equal(statusEmpty.spread, undefined, '没有牌局时不该带 spread')
assert.match(statusEmpty.message, /没有进行中的牌局/)

// 不同会话互相隔离
await run({ action: 'start', question: 'A', spread: 'one' })
const otherExec = { agent: { id: 'session-2' } }
const otherStatus = await tool.execute({ action: 'status' }, otherExec)
assert.match(otherStatus.message, /没有进行中的牌局/)

// HTTP 控制口：和工具同一份逻辑（起局 / 抽牌 / 带 session / 失败）
const ctlStart = await callControl({ action: 'start', question: '控制口', spread: 'yesno', session: 'ctl-1' })
assert.equal(ctlStart.status, 200)
assert.equal(ctlStart.json.ok, true)
assert.equal(ctlStart.json.value.spread.count, 3)
assert.match(ctlStart.json.value.message, /1–78/)

// 不带 session 的控制口请求沿用「最近一局」
const ctlPick = await callControl({ action: 'pick', numbers: [5, 6, 7] })
assert.equal(ctlPick.json.ok, true)
assert.equal(ctlPick.json.value.cards.length, 3)
assert.equal(ctlPick.json.value.remaining, 0)

const ctlView = await callRoute('?session=ctl-1')
assert.equal(ctlView.json.reading.status, 'revealed')

const ctlBad = await callControl({ action: 'pick', numbers: [5] })
assert.equal(ctlBad.status, 400)
assert.equal(ctlBad.json.ok, false)
assert.match(ctlBad.json.error, /抽满/)

const ctlEmpty = await callControl({ action: 'status', session: 'nobody' })
assert.equal(ctlEmpty.json.value.spread, undefined)

// 每局起局的牌都是洗过的
const keys = new Set()
for (let i = 0; i < 6; i += 1) {
  await run({ action: 'start', spread: 'one' })
  const view = await callRoute('?session=session-1')
  keys.add(view.json.reading.id)
  await run({ action: 'pick', numbers: [1] })
  const one = await callRoute('?session=session-1')
  keys.add(one.json.reading.slots[0].card.name)
}
assert.ok(keys.size >= 5, '牌局应该有随机性')

assert.equal(Object.keys(SPREADS).length, 6, '内置牌阵应有 6 种')

// ---- 存档 ------------------------------------------------------------------

// 抽满一局就自动落盘
const hist = await callGet('/api/tarot/history')
assert.equal(hist.status, 200)
assert.ok(hist.json.entries.length >= 2, '抽满的牌局应该自动进存档')
const ctlEntry = hist.json.entries.find((entry) => entry.id === ctlView.json.reading.id)
assert.ok(ctlEntry !== undefined, '控制口起的那局应该在存档里')
assert.equal(ctlEntry.cards.length, 3)
assert.equal(ctlEntry.note, '')

// note：把解读补进存档
const savedNote = `这一局说的是：先把自己喂饱。\n别把爱好当壳。`
const noteRes = await callControl({ action: 'note', text: savedNote, session: 'ctl-1' })
assert.equal(noteRes.json.ok, true)
const hist2 = await callGet('/api/tarot/history')
const noted = hist2.json.entries.find((entry) => entry.id === ctlEntry.id)
assert.equal(noted.note, savedNote)

// history 列表
const historyList = await run({ action: 'history' })
validate(tool.output.schema, historyList)
assert.match(historyList.message, /存档里一共/)

// import：补录一局旧牌（只有名字和正逆位，其余从牌库补全）
const imp = await callControl({
  action: 'import',
  id: 'import-test',
  question: '补录的旧牌局',
  spreadName: '时间之流',
  positions: ['过去', '现在', '未来'],
  createdAt: '2026-11-05T16:00:00.000Z',
  cards: [
    { position: '过去', name: '愚者', orientation: 'upright', number: 3 },
    { position: '现在', name: '节制', orientation: 'reversed' },
    { position: '未来', name: '星星', orientation: 'upright' },
  ],
  note: '旧的解读',
})
assert.equal(imp.json.ok, true)
assert.match(imp.json.value.message, /3 张牌/)
const hist3 = await callGet('/api/tarot/history')
const imported = hist3.json.entries.find((entry) => entry.id === 'import-test')
assert.ok(imported !== undefined)
assert.equal(imported.cards[1].orientation, 'reversed')
assert.equal(imported.cards[1].keywords, '失衡 · 急躁 · 过度消耗')

// 认不出来的牌要报错
const badImport = await callControl({ action: 'import', cards: [{ name: '不存在的牌' }] })
assert.equal(badImport.status, 400)

// 真的写进了文件，而且能重新读出来
const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
assert.equal(raw.version, 1)
assert.ok(raw.readings.length >= 3)

fs.unlinkSync(HISTORY_FILE)
console.log('smoke ok')
