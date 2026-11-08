/**
 * dsh-tarot —— Host 半侧。
 *
 * 四件事：
 *   1. 注册 tarot 工具（起局 / 抽牌 / 代抽 / 查看 / 标注 / 存档 / 导入 / 清空），按会话保存牌局；
 *   2. 注册 /api/tarot/state 与 /api/tarot/history，给网页上的「命运牌桌」拉状态和存档；
 *   3. 注册 /api/tarot/control 控制口（给拿不到工具的调用方，和工具同一份逻辑）；
 *   4. 往系统提示里加一段用法，让助手知道什么时候该请用户报数字。
 *
 * 进行中的牌局在内存里（按会话 id 隔离），抽满后自动归档到磁盘，重启也能查。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CARD_BY_NAME,
  DECK_SIZE,
  SPREADS,
  SPREAD_KEYS,
  createReading,
  readingStatus,
  readingView,
  pickNumbers,
  autoPickRemaining,
  describeReading,
} from './deck.js'

const API_PREFIX = '/api/tarot'
const TOOL_NAME = 'tarot'
const MAX_SESSIONS = 48
const HISTORY_LIMIT = 200

/** 存档文件：默认 ~/.dsh/tarot/history.json，测试可用 DSH_TAROT_HISTORY 覆盖。 */
function historyFile() {
  const explicit = process.env.DSH_TAROT_HISTORY
  if (typeof explicit === 'string' && explicit !== '') return explicit
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'tarot', 'history.json')
}

function readHistoryFile() {
  try {
    const raw = fs.readFileSync(historyFile(), 'utf8')
    const data = JSON.parse(raw)
    const list = Array.isArray(data?.readings) ? data.readings : []
    return list.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
  } catch {
    return []
  }
}

function writeHistoryFile(list) {
  const file = historyFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, readings: list }, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/** 牌阵目录：侧边栏面板的空桌页要用它列出「可以用的牌阵」。 */
const SPREAD_LIST = Object.values(SPREADS).map((spread) => ({
  key: spread.key,
  name: spread.name,
  desc: spread.desc,
  count: spread.positions.length,
  positions: spread.positions.map((pos) => ({ label: pos.label })),
}))

export const name = 'dsh-tarot'
export const inject = ['tools', 'webServer', 'systemPrompt']

const GUIDE = `## 塔罗牌桌
用户想占卜、问运势、求指引时，调用 tarot 工具，不要自己编牌。
1. action:"start"：question 记用户的原问题；spread 选 one（单张）/ three（时间之流）/ love（关系）/ career（事业）/ celtic（凯尔特十字）/ yesno（是否），也可以用 positions 自定义位置。
2. 用你自己的语气公布牌阵与位置，请用户在 1–78 里报 N 个数字（N 见返回的 count）。一次没报齐可以再问。
3. 用户报数字后 action:"pick"，numbers 传数字数组；用户说「你帮我抽」时用 action:"draw"。
4. 按「位置 × 牌 × 正逆位」逐张写解读，再收束成整体结论与能执行的建议；不做宿命式断言，给选择而不是判决。
5. 解读写完后，用 action:"note"、text 传那段解读（纯文本，不要用 ** 和表格），它会被存进「存档」页签，用户可以随时翻。
牌面会实时显示在输入框上方的牌桌和侧边栏的「命运牌桌」面板里。换问题重新用 start，清空用 reset，查历史用 history。`

const TOOL_DESCRIPTION = `塔罗牌占卜。用户想占卜、问运势、求一段关系的指引时用它，不要凭空编牌。
- action:"start"：起一局。question 填用户原问题；spread 选 one/three/love/career/celtic/yesno，或用 positions 传自定义位置名。返回牌阵、每个位置的含义，以及要用户报几个数字。
- action:"pick"：numbers 传用户报的数字（1–78，不能重复，可以分批报）。
- action:"draw"：用户让你代抽时，自动补满剩余位置。
- action:"status"：看当前牌面。
- action:"note"：text 传你写给这一局的解读，存进牌局存档（抽满后已自动存档，note 只是补上解读）。
- action:"history"：列最近的存档（问题、牌阵、张数、有没有解读）。
- action:"reset"：清掉这一局。
标准流程：start → 公布牌阵并请用户在 1–78 里选 N 个数字 → pick → 解读 → note。牌面会同步显示在输入框上方的小牌桌和侧边栏的「命运牌桌」面板里。`

/** 参数与返回都用 dsh-tools 的 JSON Schema 子集（type/oneOf/properties/required/additionalProperties/items/enum/const）。 */
const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['start', 'pick', 'draw', 'status', 'reset', 'note', 'history'],
      description: 'start 起局 | pick 按用户报的数字抽牌 | draw 代抽剩余 | status 查看 | reset 清空 | note 存解读 | history 看存档',
    },
    question: {
      type: 'string',
      description: '用户的原问题（start 时填，原话即可）',
    },
    spread: {
      type: 'string',
      enum: [...SPREAD_KEYS],
      description: '牌阵：one 单张 / three 时间之流 / love 关系 / career 事业 / celtic 凯尔特十字 / yesno 是否',
    },
    positions: {
      type: 'array',
      items: { type: 'string' },
      description: '自定义牌阵的位置名（最多 10 个），给了就覆盖 spread',
    },
    numbers: {
      type: 'array',
      items: { type: 'integer' },
      description: '用户报的牌号，1–78，不能重复',
    },
    text: {
      type: 'string',
      description: 'note 用的解读正文（纯文本）',
    },
    id: {
      type: 'string',
      description: '存档条目 id（note 时可选，默认改当前这一局）',
    },
  },
  required: ['action'],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    message: { type: 'string' },
    spread: {
      type: 'object',
      additionalProperties: false,
      properties: {
        key: { type: 'string' },
        name: { type: 'string' },
        count: { type: 'integer' },
        positions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string' },
              hint: { type: 'string' },
            },
            required: ['label', 'hint'],
          },
        },
      },
      required: ['key', 'name', 'count', 'positions'],
    },
    picked: { type: 'array', items: { type: 'integer' } },
    remaining: { type: 'integer' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          position: { type: 'string' },
          number: { type: 'integer' },
          name: { type: 'string' },
          en: { type: 'string' },
          orientation: { type: 'string', enum: ['upright', 'reversed'] },
          keywords: { type: 'string' },
          core: { type: 'string' },
        },
        required: ['position', 'number', 'name', 'en', 'orientation', 'keywords', 'core'],
      },
    },
  },
  required: ['ok', 'action', 'message', 'picked', 'remaining', 'cards'],
}

/** 一段短文本内容块。 */
function textBlock(text) {
  return [{ type: 'text', text }]
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text, 'utf8')),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function spreadOf(reading) {
  const positions = reading.positions.map((pos) => ({ label: pos.label, hint: pos.hint }))
  return {
    key: reading.spreadKey,
    name: reading.spreadName,
    count: positions.length,
    positions,
  }
}

/** 工具返回值（同时满足 OUTPUT_SCHEMA）。 */
function toolValue(action, reading, message, cards) {  const picked = reading === null ? [] : reading.picks.map((pick) => pick.number)
  const total = reading === null ? 0 : reading.positions.length
  const value = {
    ok: true,
    action,
    message,
    picked,
    remaining: Math.max(0, total - picked.length),
    cards: cards ?? [],
  }
  if (reading !== null) value.spread = spreadOf(reading)
  return value
}

/** 只保留 OUTPUT_SCHEMA 里声明过的字段（additionalProperties: false）。 */
function toCardOutput(card) {
  return {
    position: card.position,
    number: card.number,
    name: card.name,
    en: card.en,
    orientation: card.orientation,
    keywords: card.keywords,
    core: card.core,
  }
}

export function apply(ctx) {
  /** 会话 id → 牌局。 */
  const readings = new Map()
  /** 会话 id → 版本号（网页轮询靠它判断有没有变）。 */
  const versions = new Map()
  /** 只用于确认「网页真的连上了」。 */
  const bridge = { count: 0, lastSeen: '', lastSession: '' }
  /** 最近一局属于哪个会话（侧边栏面板没有会话绑定，靠它显示「当前这张桌子」）。 */
  const latest = { session: '' }
  /** 抽满的牌局会落到这里，并能随时写回磁盘。 */
  let history = readHistoryFile()

  const bump = (session) => {
    const next = (versions.get(session) ?? 0) + 1
    versions.set(session, next)
    return next
  }

  /** 一局牌 → 存档条目（带上已经写好的解读）。 */
  const entryOf = (reading) => {
    const view = readingView(reading)
    const existing = history.find((entry) => entry.id === reading.id)
    return {
      id: reading.id,
      question: view.question,
      spread: view.spread,
      status: view.status,
      createdAt: view.createdAt,
      revealedAt: reading.revealedAt ?? new Date().toISOString(),
      picks: view.picks,
      cards: view.slots.filter((slot) => slot.card !== null).map((slot) => slot.card),
      note: existing !== undefined ? existing.note : '',
    }
  }

  const upsertHistory = (entry) => {
    const index = history.findIndex((item) => item.id === entry.id)
    if (index >= 0) history[index] = { ...history[index], ...entry }
    else history.unshift(entry)
    if (history.length > HISTORY_LIMIT) history = history.slice(0, HISTORY_LIMIT)
    writeHistoryFile(history)
    return entry
  }

  /** 牌抽满的那一刻自动存档（解读之后用 note 补上）。 */
  const archiveIfRevealed = (reading) => {
    if (readingStatus(reading) !== 'revealed') return
    if (reading.revealedAt === undefined) reading.revealedAt = new Date().toISOString()
    const existing = history.find((entry) => entry.id === reading.id)
    if (existing !== undefined && Array.isArray(existing.cards) && existing.cards.length === reading.positions.length) return
    upsertHistory(entryOf(reading))
  }

  const prune = () => {
    if (readings.size <= MAX_SESSIONS) return
    const kept = [...readings.entries()].sort((a, b) => (a[1].createdAt < b[1].createdAt ? -1 : 1))
    for (const [session] of kept.slice(0, readings.size - MAX_SESSIONS)) {
      readings.delete(session)
      versions.delete(session)
    }
  }

  const sessionOf = (exec) => {
    const id = exec !== null && exec !== undefined && exec.agent !== null && exec.agent !== undefined ? exec.agent.id : ''
    return typeof id === 'string' && id !== '' ? id : 'default'
  }

  /**
   * 一局牌的全部操作：工具和 HTTP 控制口都走这里，只有一份逻辑。
   * 抛出的错误就是给调用方看的失败原因。
   */
  const runCommand = async (session, rawArgs) => {
    const args = rawArgs !== null && typeof rawArgs === 'object' ? rawArgs : {}
    const action = typeof args.action === 'string' ? args.action : 'status'
    const current = readings.get(session) ?? null

    if (action === 'start') {
      const reading = createReading({
        question: args.question,
        spreadKey: typeof args.spread === 'string' ? args.spread : 'three',
        positions: Array.isArray(args.positions) ? args.positions : undefined,
      })
      readings.set(session, reading)
      latest.session = session
      prune()
      bump(session)
      const count = reading.positions.length
      const lines = [
        `【${reading.spreadName}】已经起局，共 ${count} 张。`,
        ...reading.positions.map((pos, i) => `${i + 1}. ${pos.label} —— ${pos.hint}`),
        '',
        `请用你自己的语气把牌阵告诉用户，并让 ta 在 1–${DECK_SIZE} 里选 ${count} 个数字（可以一次报齐，也可以分批）。`,
        '选定的牌会显示在输入框上方的「命运牌桌」里，别提前说牌面。',
      ]
      return toolValue(action, reading, lines.join('\n'))
    }

    if (action === 'reset') {
      readings.delete(session)
      if (latest.session === session) latest.session = ''
      bump(session)
      return toolValue('reset', null, '牌局已经收起来了。想再问就重新 start。')
    }

    if (action === 'status') {
      if (current === null) {
        return toolValue('status', null, '现在没有进行中的牌局。用户想占卜的话，用 action:"start" 起一局。')
      }
      const head = readingStatus(current) === 'revealed'
        ? '这一局已经抽满。'
        : `这一局还差 ${current.positions.length - current.nextSlot} 张没抽。`
      return toolValue('status', current, `${describeReading(current)}\n\n${head}`)
    }

    if (action === 'pick') {
      const numbers = Array.isArray(args.numbers) ? args.numbers : []
      const added = pickNumbers(current, numbers)
      latest.session = session
      bump(session)
      const reading = readings.get(session)
      const count = reading.positions.length
      const left = count - reading.nextSlot
      const lines = [describeReading(reading)]
      lines.push('')
      if (left > 0) {
        lines.push(`已抽 ${reading.nextSlot}/${count}，还差 ${left} 张。请让用户在 1–${DECK_SIZE} 里再报 ${left} 个数字。`)
      } else {
        lines.push('牌已经抽满，可以直接给解读了（记住牌面会同步显示在牌桌上）。')
      }
      if (added.length > 0) {
        lines.push(`本次抽到：${added.map((card) => `${card.name}${card.orientation === 'reversed' ? '（逆位）' : ''}`).join('、')}`)
      }
      archiveIfRevealed(reading)
      return toolValue('pick', reading, lines.join('\n'), added.map(toCardOutput))
    }

    if (action === 'draw') {
      if (current === null) throw new Error('还没有开牌，先用 action:"start" 起一局')
      const added = autoPickRemaining(current)
      latest.session = session
      bump(session)
      const count = current.positions.length
      const lines = [describeReading(current), '']
      lines.push(`已代抽 ${current.nextSlot}/${count}。`)
      lines.push(`本次抽到：${added.map((card) => `${card.name}${card.orientation === 'reversed' ? '（逆位）' : ''}`).join('、')}`)
      archiveIfRevealed(current)
      return toolValue('draw', current, lines.join('\n'), added.map(toCardOutput))
    }

    if (action === 'note') {
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      const id = typeof args.id === 'string' && args.id !== '' ? args.id : current !== null ? current.id : ''
      if (id === '') throw new Error('没有可以写解读的牌局：先抽满一局，或传 id')
      let entry = history.find((item) => item.id === id)
      if (entry === undefined && current !== null && current.id === id) entry = entryOf(current)
      if (entry === undefined) throw new Error(`存档里没有 id=${id} 的牌局`)
      entry = upsertHistory({ ...entry, note: text })
      return toolValue('note', current, `解读已经写进存档（「${entry.question || '无问题'}」· ${entry.cards.length} 张）。`)
    }

    if (action === 'history') {
      if (history.length === 0) {
        return toolValue('history', current, '牌局存档还是空的：抽满一局之后会自动存下来。')
      }
      const lines = history.slice(0, 30).map((entry, index) => {
        const when = new Date(entry.createdAt)
        const stamp = Number.isNaN(when.getTime())
          ? ''
          : `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
        const spread = entry.spread !== null && typeof entry.spread === 'object' ? entry.spread.name : ''
        return `${index + 1}. ${stamp} 「${entry.question || '无问题'}」 ${spread} ${entry.cards.length} 张${entry.note ? ' · 有解读' : ''}`
      })
      return toolValue('history', current, [`存档里一共 ${history.length} 局：`, ...lines].join('\n'))
    }

    if (action === 'import') {
      const cards = Array.isArray(args.cards) ? args.cards : []
      const resolved = []
      const missing = []
      for (const item of cards) {
        const card = CARD_BY_NAME.get(String(item !== null && typeof item === 'object' ? item.name : '').trim())
        if (card === undefined) {
          missing.push(String(item !== null && typeof item === 'object' ? item.name : item))
          continue
        }
        const reversed = item.orientation === 'reversed'
        resolved.push({
          position: typeof item.position === 'string' ? item.position : '',
          number: Number.isInteger(item.number) ? item.number : 0,
          name: card.name,
          en: card.en,
          arcana: card.arcana,
          suit: card.suit,
          rank: card.rank,
          roman: card.roman,
          sym: card.sym,
          orientation: reversed ? 'reversed' : 'upright',
          keywords: reversed ? card.r : card.u,
          core: card.core,
        })
      }
      if (resolved.length === 0) throw new Error(`一张牌都没认出来：${missing.join('、') || '（空）'}`)
      const entry = upsertHistory({
        id: typeof args.id === 'string' && args.id !== '' ? args.id : `import-${Date.now().toString(36)}`,
        question: typeof args.question === 'string' ? args.question : '',
        spread: {
          key: 'imported',
          name: typeof args.spreadName === 'string' && args.spreadName !== '' ? args.spreadName : '导入的牌局',
          count: resolved.length,
          positions: resolved.map((card) => ({ label: card.position, hint: '' })),
        },
        status: 'revealed',
        createdAt: typeof args.createdAt === 'string' && args.createdAt !== '' ? args.createdAt : new Date().toISOString(),
        revealedAt: new Date().toISOString(),
        picks: resolved.map((card) => card.number),
        cards: resolved,
        note: typeof args.note === 'string' ? args.note : '',
      })
      const tail = missing.length > 0 ? `（没认出来：${missing.join('、')}）` : ''
      return toolValue('import', current, `导入了 ${entry.cards.length} 张牌的牌局${tail}。`)
    }

    throw new Error(`不认识的 action：${String(action)}（可用 start / pick / draw / status / reset / note / history / import）`)
  }

  /** 读 JSON 请求体（控制口用）。 */
  const readBody = (req, maxBytes = 64 * 1024) =>
    new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          req.destroy()
          reject(new Error('请求体过大'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8').trim()
          resolve(text === '' ? {} : JSON.parse(text))
        } catch (error) {
          reject(error)
        }
      })
      req.on('error', reject)
    })

  // ---- 1. 同源接口（只读 state + 控制口）--------------------------------
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const route = url.pathname.slice(API_PREFIX.length) || '/'

            // 控制口：给「拿不到 tarot 工具的调用方」（比如 CLI 脚本）用，和工具同一份逻辑。
            if (route === '/control' && req.method === 'POST') {
              let body = null
              try {
                body = await readBody(req)
              } catch (error) {
                return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
              }
              const requested = typeof body.session === 'string' && body.session !== '' ? body.session : latest.session || 'default'
              try {
                const value = await runCommand(requested, body)
                return sendJson(res, 200, { ok: true, value })
              } catch (error) {
                return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
            }

            // 存档：侧边栏面板的「存档」页签读这里。
            if ((route === '/history' || route === '/history/') && (req.method === 'GET' || req.method === 'HEAD')) {
              return sendJson(res, 200, {
                entries: history,
                file: historyFile(),
                total: history.length,
              })
            }

            if (route !== '/state' && route !== '/' && route !== '') {
              return sendJson(res, 404, { error: 'not found' })
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              return sendJson(res, 405, { error: 'method not allowed' })
            }

            bridge.count += 1
            bridge.lastSeen = new Date().toISOString()

            const requested = url.searchParams.get('session') ?? ''
            if (requested !== '') bridge.lastSession = requested
            // 没带 session 的请求来自侧边栏面板：给它「最近一局」。
            const session = requested !== '' ? requested : latest.session
            const sinceRaw = url.searchParams.get('since')
            const since = sinceRaw === null ? -1 : Number(sinceRaw)
            const version = versions.get(session) ?? 0
            const reading = readings.get(session) ?? null

            if (Number.isFinite(since) && since === version) {
              return sendJson(res, 200, { v: version, unchanged: true })
            }
            return sendJson(res, 200, {
              v: version,
              reading: readingView(reading),
              spreads: SPREAD_LIST,
              bridge: { count: bridge.count, lastSeen: bridge.lastSeen, lastSession: bridge.lastSession ?? '' },
            })
          } catch (error) {
            try {
              sendJson(res, 500, { error: error instanceof Error ? error.message : 'tarot api failed' })
            } catch {
              /* 响应已断开 */
            }
          }
        },
      }),
    'dsh-tarot: state api',
  )

  // ---- 2. 工具 ---------------------------------------------------------
  ctx.effect(
    () =>
      ctx.tools.register({
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        parameters: PARAMETERS,
        output: {
          schema: OUTPUT_SCHEMA,
          render: (_args, value) => textBlock(typeof value?.message === 'string' ? value.message : ''),
        },
        presentCall: (args) => ({
          card: 'generic',
          title: `塔罗 · ${callTitle(args)}`,
          kind: 'other',
        }),
        execute: (rawArgs, exec) => runCommand(sessionOf(exec), rawArgs),
      }),
    'dsh-tarot: tool',
  )

  // ---- 3. 系统提示 -----------------------------------------------------
  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'tarot:table', order: 137, text: GUIDE }),
    'dsh-tarot: prompt',
  )
}

/** 工具卡片的标题（执行前就要有，所以只读 args）。 */
function callTitle(args) {
  const action = args !== null && typeof args === 'object' && typeof args.action === 'string' ? args.action : 'status'
  if (action === 'start') {
    const spread = args !== null && typeof args === 'object' && typeof args.spread === 'string' ? args.spread : 'three'
    return `起局 · ${SPREADS[spread]?.name ?? '时间之流'}`
  }
  if (action === 'pick') {
    const numbers = args !== null && typeof args === 'object' && Array.isArray(args.numbers) ? args.numbers : []
    return `抽牌${numbers.length > 0 ? ` · ${numbers.join(' ')}` : ''}`
  }
  if (action === 'draw') return '代抽'
  if (action === 'reset') return '收牌'
  return '牌面'
}
