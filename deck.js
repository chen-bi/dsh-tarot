/**
 * dsh-tarot —— 牌库与牌阵（纯数据 + 纯函数，不含任何 DSH API）。
 *
 * 78 张全牌（22 大阿卡纳 + 4 花色 × 14 张），每张带正/逆位关键词与一句「核心」，
 * 供助手解牌、也给牌桌上的卡片当副标题。
 */

export const DECK_SIZE = 78

/** 花色：名称、元素、英文名。 */
export const SUITS = {
  wands: { name: '权杖', element: '火', en: 'Wands' },
  cups: { name: '圣杯', element: '水', en: 'Cups' },
  swords: { name: '宝剑', element: '风', en: 'Swords' },
  pentacles: { name: '星币', element: '土', en: 'Pentacles' },
}

/** 小阿卡纳的位阶。 */
export const RANKS = [
  { key: 'a', name: '王牌', en: 'Ace' },
  { key: '2', name: '二', en: 'Two' },
  { key: '3', name: '三', en: 'Three' },
  { key: '4', name: '四', en: 'Four' },
  { key: '5', name: '五', en: 'Five' },
  { key: '6', name: '六', en: 'Six' },
  { key: '7', name: '七', en: 'Seven' },
  { key: '8', name: '八', en: 'Eight' },
  { key: '9', name: '九', en: 'Nine' },
  { key: '10', name: '十', en: 'Ten' },
  { key: 'page', name: '侍从', en: 'Page' },
  { key: 'knight', name: '骑士', en: 'Knight' },
  { key: 'queen', name: '王后', en: 'Queen' },
  { key: 'king', name: '国王', en: 'King' },
]

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI']

/** 大阿卡纳：[key, 中文名, 英文名, 象征符, 正位, 逆位, 核心]。 */
const MAJORS = [
  ['fool', '愚者', 'The Fool', '✦', '开始 · 冒险 · 纯真 · 自由', '鲁莽 · 逃避 · 计划不足', '背起行囊就出发，未知本身就是礼物。'],
  ['magician', '魔术师', 'The Magician', '☿', '创造 · 行动 · 沟通 · 资源到位', '空谈 · 操弄 · 信心不足', '你已经拥有需要的工具，只差动手。'],
  ['high-priestess', '女祭司', 'The High Priestess', '☽', '直觉 · 潜意识 · 秘密 · 静观', '忽视直觉 · 隐瞒 · 与自己断裂', '答案不在外面，在你还没说出口的那部分。'],
  ['empress', '女皇', 'The Empress', '♀', '滋养 · 丰盛 · 创造 · 温柔', '过度付出 · 依赖 · 停滞', '先把自己喂饱，你才有东西给别人。'],
  ['emperor', '皇帝', 'The Emperor', '♈', '秩序 · 掌控 · 责任 · 结构', '专断 · 僵化 · 失控', '规则不是束缚，是让别人放心的承诺。'],
  ['hierophant', '教皇', 'The Hierophant', '♉', '传承 · 信念 · 指引 · 规范', '教条 · 叛逆 · 形式主义', '有些路，前人已经替你走过一遍。'],
  ['lovers', '恋人', 'The Lovers', '♊', '选择 · 结合 · 共鸣 · 价值一致', '犹豫 · 失衡 · 表面和平', '真正的选择，是选你愿意为之负责的那个。'],
  ['chariot', '战车', 'The Chariot', '♋', '意志 · 前进 · 胜利 · 自律', '内耗 · 方向不明 · 用力过猛', '两股力同时在拉，缰绳在你手里。'],
  ['strength', '力量', 'Strength', '♌', '耐心 · 温柔的力量 · 勇气 · 驯服', '自我怀疑 · 冲动 · 被情绪牵着走', '不必压过谁，稳住自己就够了。'],
  ['hermit', '隐者', 'The Hermit', '♍', '独处 · 内省 · 寻找 · 指引', '孤立 · 逃避 · 拒绝求助', '退一步不是消失，是把灯举高一点。'],
  ['wheel', '命运之轮', 'Wheel of Fortune', '☸', '转机 · 周期 · 时机 · 顺势', '停滞 · 逆势 · 重复旧模式', '轮子在转，你能决定的是抓不抓住。'],
  ['justice', '正义', 'Justice', '⚖', '平衡 · 因果 · 诚实 · 抉择', '偏颇 · 逃避责任 · 不公', '你得到的是你曾经给出的，账很清楚。'],
  ['hanged-man', '倒吊人', 'The Hanged Man', '♆', '暂停 · 换位 · 牺牲 · 顿悟', '无谓拖延 · 自我感动 · 拒绝放手', '换个角度看，卡住的地方会松动。'],
  ['death', '死神', 'Death', '☠', '结束 · 蜕变 · 断舍离 · 重生', '抗拒结束 · 拖泥带水 · 恐惧改变', '不结束旧的，新的就没有位置。'],
  ['temperance', '节制', 'Temperance', '♐', '调和 · 适度 · 疗愈 · 耐心', '失衡 · 急躁 · 过度消耗', '不是少一点，是刚刚好。'],
  ['devil', '恶魔', 'The Devil', '♑', '诱惑 · 束缚 · 欲望 · 执念', '挣脱 · 觉察 · 重获自由', '锁链往往没上锁，是你不肯走。'],
  ['tower', '高塔', 'The Tower', '⚡', '崩塌 · 突变 · 真相 · 清理', '勉强维持 · 延迟的崩塌 · 恐惧', '塌掉的是不属于你的部分。'],
  ['star', '星星', 'The Star', '★', '希望 · 治愈 · 灵感 · 清晰', '失望 · 信心动摇 · 好高骛远', '夜再长，星还在原处。'],
  ['moon', '月亮', 'The Moon', '☾', '迷雾 · 不安 · 梦 · 直觉', '真相浮现 · 恐惧退散 · 释怀', '看不清的时候，先别急着下判断。'],
  ['sun', '太阳', 'The Sun', '☉', '成功 · 光明 · 喜悦 · 坦率', '短暂低落 · 过度乐观 · 延迟的好消息', '把话说亮，事情就亮了一半。'],
  ['judgement', '审判', 'Judgement', '♇', '觉醒 · 召唤 · 清算 · 重生', '自我审判 · 逃避面对 · 犹豫', '该回应那个呼唤了，你知道是哪一个。'],
  ['world', '世界', 'The World', '♄', '完成 · 圆满 · 整合 · 远行', '收尾未竟 · 差临门一脚 · 恋战', '这一圈走完，你已经是新的你。'],
]

/** 小阿卡纳：[正位, 逆位, 核心]，顺序与 RANKS 一致。 */
const MINORS = {
  wands: [
    ['灵感 · 起点 · 热情', '动力熄火 · 迟迟不开始', '火种已经点着，只差你伸手。'],
    ['规划 · 远望 · 选择方向', '计划空转 · 害怕出发', '地图摊开了，先选一条路。'],
    ['拓展 · 等待回音 · 远景', '进度卡住 · 目光太短', '船已经在海上，别天天盯着码头。'],
    ['安定 · 庆祝 · 归属', '根基未稳 · 家庭摩擦', '值得停下来庆祝一下。'],
    ['竞争 · 摩擦 · 各执一词', '回避冲突 · 内耗', '吵吵闹闹，也是一种在乎。'],
    ['胜利 · 认可 · 凯旋', '虚荣 · 认可延迟', '赢要赢得坦荡。'],
    ['坚守 · 防守 · 立场', '疲惫 · 撑不住 · 放弃阵地', '你守着的那个东西，真的值得吗？'],
    ['迅速 · 消息 · 推进', '延误 · 信息错位', '消息会比你想象的来得快。'],
    ['韧性 · 警戒 · 最后一步', '固执 · 伤痕累累', '已经走了这么远，再撑一下。'],
    ['重担 · 责任 · 超负荷', '学会放下 · 分派', '不必全扛在自己肩上。'],
    ['好奇 · 新消息 · 尝试', '三分钟热度 · 不成熟', '先玩起来，热情会自己长出来。'],
    ['冲劲 · 冒险 · 行动', '莽撞 · 半途而废', '快是好事，方向更重要。'],
    ['自信 · 魅力 · 掌控', '嫉妒 · 自我怀疑', '你的光不需要谁批准。'],
    ['领导 · 远见 · 魄力', '独断 · 急躁', '带头的人，先要稳住那把火。'],
  ],
  cups: [
    ['爱意 · 感动 · 新的感情', '情感淤堵 · 空杯', '杯子是满的，你敢不敢接。'],
    ['结合 · 互信 · 吸引', '不对等 · 裂痕', '两个人都愿意，才算数。'],
    ['友谊 · 欢聚 · 庆祝', '塑料情谊 · 过度社交', '被人陪着，是件很奢侈的事。'],
    ['倦怠 · 错过 · 内省', '重新接受 · 走出低潮', '你盯着的那一只，未必是最好的。'],
    ['失落 · 遗憾 · 回头', '释怀 · 重新看见', '洒掉的水收不回来，身后的还在。'],
    ['回忆 · 童真 · 旧人', '困在过去 · 美化记忆', '回头看可以，别走回去。'],
    ['幻想 · 选择太多 · 迷雾', '看清 · 做出决定', '想得越多，越动不了。'],
    ['离开 · 追寻 · 放下', '舍不得 · 原地徘徊', '走开不是背叛，是对自己诚实。'],
    ['满足 · 如愿 · 享受', '贪心 · 满足感短暂', '愿望成真了，然后呢？'],
    ['圆满 · 家庭 · 长久', '表面美满 · 期待落差', '你要的那种幸福，其实很朴素。'],
    ['心动 · 温柔 · 灵感', '情绪化 · 不切实际', '心里那点小鹿，别急着按回去。'],
    ['浪漫 · 邀请 · 追随内心', '承诺不实 · 逃避现实', '说得再好，也要看做到哪一步。'],
    ['共情 · 温柔 · 直觉', '情绪淹没 · 讨好', '照顾别人之前，先照顾自己的心。'],
    ['情绪稳定 · 包容 · 成熟', '压抑 · 情感操控', '能安放情绪的人，才安放得了关系。'],
  ],
  swords: [
    ['清晰 · 真相 · 决断', '混乱 · 言语伤人', '想明白了，其实是一句话的事。'],
    ['僵持 · 回避 · 两难', '看清 · 打破僵局', '不做选择，本身也是一种选择。'],
    ['心碎 · 刺痛 · 分离', '愈合 · 放下', '会痛，是证据，证明你真的在乎过。'],
    ['休息 · 疗养 · 暂停', '硬撑 · 无法停下', '先睡一觉，天塌不下来。'],
    ['争执 · 输赢 · 代价', '和解 · 及时止损', '赢了这一句，可能输掉那个人。'],
    ['过渡 · 离开 · 平静', '滞留 · 旧伤复发', '船在往对岸走，允许自己慢一点。'],
    ['策略 · 隐瞒 · 单打独斗', '被揭穿 · 坦诚', '绕路可以，别绕到自己都迷路。'],
    ['受困 · 自我设限 · 恐惧', '松绑 · 看见出路', '限制你的，多半是想象。'],
    ['焦虑 · 失眠 · 过度思虑', '释怀 · 走出噩梦', '夜里想的事，天亮会轻一半。'],
    ['终结 · 谷底 · 无可再失', '触底反弹 · 复原', '到底了，接下来只剩往上。'],
    ['求知 · 观察 · 直率', '多疑 · 口无遮拦', '问清楚，比猜准确。'],
    ['果断 · 冲锋 · 直击', '冲动 · 伤人伤己', '锋利是本事，收刀也是。'],
    ['理智 · 独立 · 洞察', '冷漠 · 刻薄', '清醒的人，最容易孤独。'],
    ['公正 · 权威 · 逻辑', '独断 · 冷硬', '讲道理之前，先讲感受。'],
  ],
  pentacles: [
    ['机会 · 实在的开始 · 资源', '错失 · 基础不稳', '种子在手，先找个地方种下去。'],
    ['平衡 · 兼顾 · 灵活', '顾此失彼 · 分身乏术', '两个球都在空中，节奏比力气重要。'],
    ['协作 · 专业 · 打磨', '配合失调 · 敷衍', '好东西，都是一起做出来的。'],
    ['保守 · 稳定 · 守住', '吝啬 · 过度紧抓', '攥得太紧，手心就没有空位了。'],
    ['匮乏 · 困顿 · 被排除', '转机 · 接受帮助', '门开着，是你一直没抬头。'],
    ['给予 · 回报 · 公平交换', '施舍关系 · 失衡', '接受和给予，一样需要底气。'],
    ['耐心 · 等待收成 · 评估', '白费功夫 · 急功近利', '种下去的东西，还没到收的时候。'],
    ['专注 · 精进 · 手艺', '重复厌倦 · 敷衍了事', '把一件小事做透，机会自己会来。'],
    ['自足 · 优雅 · 独处', '依附 · 表面光鲜', '你一个人也过得很好，这很重要。'],
    ['丰盛 · 家族 · 长远', '负担 · 传承压力', '你在为谁攒这些东西？'],
    ['学习 · 务实 · 起步', '拖延 · 眼高手低', '从最小的一步开始。'],
    ['稳扎稳打 · 可靠 · 坚持', '固执 · 太慢', '慢一点没关系，别停。'],
    ['照料 · 丰饶 · 落地', '过度操劳 · 失去自我', '把日子过好，是一种才能。'],
    ['成就 · 稳固 · 富足', '守成 · 物质主义', '你已经有了底，可以谈点更大的。'],
  ],
}

/** 全牌库。 */
export const CARDS = []

for (let i = 0; i < MAJORS.length; i += 1) {
  const [key, name, en, sym, u, r, core] = MAJORS[i]
  CARDS.push({ key, name, en, arcana: 'major', suit: null, rank: null, roman: ROMAN[i], sym, u, r, core })
}

for (const suitKey of Object.keys(SUITS)) {
  const rows = MINORS[suitKey]
  for (let i = 0; i < RANKS.length; i += 1) {
    const rank = RANKS[i]
    const [u, r, core] = rows[i]
    CARDS.push({
      key: `${suitKey}-${rank.key}`,
      name: `${SUITS[suitKey].name}${rank.name}`,
      en: `${rank.en} of ${SUITS[suitKey].en}`,
      arcana: 'minor',
      suit: suitKey,
      rank: rank.key,
      roman: null,
      sym: null,
      u,
      r,
      core,
    })
  }
}

export const CARD_BY_KEY = new Map(CARDS.map((card) => [card.key, card]))
/** 按中文名索引：导入历史牌局时靠名字找回牌面数据。 */
export const CARD_BY_NAME = new Map(CARDS.map((card) => [card.name, card]))

if (CARDS.length !== DECK_SIZE) {
  throw new Error(`dsh-tarot: 牌库应为 ${DECK_SIZE} 张，实际 ${CARDS.length} 张`)
}

/** 牌阵。positions 里每一项是 {label, hint}。 */
export const SPREADS = {
  one: {
    key: 'one',
    name: '单张指引',
    desc: '一个当下最需要知道的答案。',
    positions: [
      { label: '此刻的指引', hint: '牌面给你的那盏灯' },
    ],
  },
  three: {
    key: 'three',
    name: '时间之流',
    desc: '过去、现在、未来，看一件事的走向。',
    positions: [
      { label: '过去', hint: '已经发生的、把你带到这里的' },
      { label: '现在', hint: '此刻真正的局面' },
      { label: '未来', hint: '顺其自然会走到的方向' },
    ],
  },
  love: {
    key: 'love',
    name: '关系之镜',
    desc: '看两个人的位置，以及你们之间的那条线。',
    positions: [
      { label: '你', hint: '你在这段关系里的状态' },
      { label: '对方', hint: 'ta 此刻的状态与心思' },
      { label: '连结', hint: '你们之间的那股能量' },
      { label: '阻碍', hint: '卡住你们的地方' },
      { label: '建议', hint: '你可以怎么走' },
    ],
  },
  career: {
    key: 'career',
    name: '事业十字',
    desc: '工作与选择：局面、机会、阻力与出口。',
    positions: [
      { label: '现状', hint: '你所在的位置' },
      { label: '机会', hint: '可以抓住的东西' },
      { label: '阻碍', hint: '真正拖住你的' },
      { label: '你的底牌', hint: '你手上已有的资源' },
      { label: '建议', hint: '下一步怎么走' },
    ],
  },
  celtic: {
    key: 'celtic',
    name: '凯尔特十字',
    desc: '十张牌的完整盘面，适合重要且复杂的问题。',
    positions: [
      { label: '现状', hint: '事情的核心' },
      { label: '挑战', hint: '横在中间的力量' },
      { label: '根基', hint: '深处的成因' },
      { label: '过去', hint: '正在退场的' },
      { label: '目标', hint: '你想要的、意识里的' },
      { label: '近期', hint: '很快会到来的' },
      { label: '自己', hint: '你的姿态' },
      { label: '环境', hint: '他人与外部条件' },
      { label: '希望与恐惧', hint: '你暗处的期待' },
      { label: '结果', hint: '照此走下去的落点' },
    ],
  },
  yesno: {
    key: 'yesno',
    name: '是否之间',
    desc: '一个二选一的问题，看两股力量的分量。',
    positions: [
      { label: '支持的力量', hint: '推动「是」的' },
      { label: '反对的力量', hint: '拉向「否」的' },
      { label: '建议', hint: '你该看的方向' },
    ],
  },
}

export const SPREAD_KEYS = Object.keys(SPREADS)

const DEFAULT_HINT = ''

/** 解析牌阵：允许用自定义位置覆盖内置牌阵。 */
export function resolveSpread(spreadKey, customPositions) {
  const custom = Array.isArray(customPositions)
    ? customPositions
        .map((label) => (typeof label === 'string' ? label.trim() : ''))
        .filter((label) => label !== '')
    : []

  if (custom.length > 0) {
    if (custom.length > 10) throw new Error('自定义牌阵最多 10 张牌')
    return {
      key: 'custom',
      name: '自定义牌阵',
      desc: '按你指定的位置来解。',
      positions: custom.map((label) => ({ label: label.slice(0, 24), hint: DEFAULT_HINT })),
    }
  }

  const spread = SPREADS[spreadKey] ?? SPREADS.three
  return spread
}

/** Fisher–Yates 洗牌。 */
function shuffle(list) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

let counter = 0

/** 起一局。返回的 order 是洗好的 78 张（含正逆位），用户报的号码 = 序号 1..78。 */
export function createReading({ question, spreadKey, positions } = {}) {
  const spread = resolveSpread(spreadKey, positions)
  counter += 1
  const order = shuffle(CARDS.map((card) => card.key)).map((key) => ({
    key,
    reversed: Math.random() < 0.36,
  }))
  return {
    id: `t${Date.now().toString(36)}${counter.toString(36)}`,
    question: typeof question === 'string' ? question.trim().slice(0, 300) : '',
    spreadKey: spread.key,
    spreadName: spread.name,
    positions: spread.positions,
    order,
    picks: [],
    nextSlot: 0,
    createdAt: new Date().toISOString(),
  }
}

export function readingStatus(reading) {
  if (reading === null || reading === undefined) return 'empty'
  if (reading.nextSlot >= reading.positions.length) return 'revealed'
  return reading.nextSlot > 0 ? 'partial' : 'awaiting'
}

/** 某张牌在某位置上的展示数据。 */
function dealCard(reading, pick) {
  const entry = reading.order[pick.number - 1]
  const card = CARD_BY_KEY.get(entry.key)
  const reversed = entry.reversed
  return {
    position: reading.positions[pick.slot].label,
    number: pick.number,
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
  }
}

/** 给网页牌桌的状态（不含未抽到的牌）。 */
export function readingView(reading) {
  if (reading === null || reading === undefined) return null
  return {
    id: reading.id,
    question: reading.question,
    createdAt: reading.createdAt,
    status: readingStatus(reading),
    spread: {
      key: reading.spreadKey,
      name: reading.spreadName,
      count: reading.positions.length,
      positions: reading.positions.map((pos) => ({ label: pos.label, hint: pos.hint })),
    },
    deckSize: DECK_SIZE,
    picks: reading.picks.map((pick) => pick.number),
    slots: reading.positions.map((pos, index) => {
      const pick = reading.picks[index]
      return {
        index,
        position: { label: pos.label, hint: pos.hint },
        card: pick === undefined ? null : dealCard(reading, pick),
      }
    }),
  }
}

/** 抽牌：把号码落到下一个空位上。任何非法数字都会整体拒绝，不改状态。 */
export function pickNumbers(reading, numbers) {
  if (reading === null || reading === undefined) throw new Error('还没有开牌，先用 action:"start" 起一局')
  if (!Array.isArray(numbers) || numbers.length === 0) throw new Error('numbers 需要一个非空的数字数组')

  const remaining = reading.positions.length - reading.nextSlot
  if (remaining <= 0) throw new Error('这一局已经抽满了，想看新的问题请重新 start')

  const problems = []
  const fresh = []
  for (const raw of numbers) {
    const number = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
    if (!Number.isInteger(number) || number < 1 || number > DECK_SIZE) {
      problems.push(`${String(raw)} 不是 1–${DECK_SIZE} 之间的整数`)
      continue
    }
    if (fresh.includes(number) || reading.picks.some((pick) => pick.number === number)) {
      problems.push(`${number} 已经抽过了`)
      continue
    }
    if (fresh.length >= remaining) {
      problems.push(`这一局只要 ${reading.positions.length} 张，多给了 ${number}`)
      continue
    }
    fresh.push(number)
  }

  if (problems.length > 0) throw new Error(problems.join('；'))

  const added = []
  for (const number of fresh) {
    const pick = { number, slot: reading.nextSlot }
    reading.picks.push(pick)
    reading.nextSlot += 1
    added.push(dealCard(reading, pick))
  }
  return added
}

/** 帮用户代抽剩下的牌（用户说「你帮我抽」时用）。 */
export function autoPickRemaining(reading) {
  if (reading === null || reading === undefined) throw new Error('还没有开牌，先用 action:"start" 起一局')
  const taken = new Set(reading.picks.map((pick) => pick.number))
  const pool = []
  for (let n = 1; n <= DECK_SIZE; n += 1) if (!taken.has(n)) pool.push(n)
  const picks = shuffle(pool).slice(0, reading.positions.length - reading.nextSlot).sort((a, b) => a - b)
  return pickNumbers(reading, picks)
}

/** 把牌面写成给模型看的多行文本。 */
export function describeReading(reading) {
  const view = readingView(reading)
  if (view === null) return ''
  const lines = []
  lines.push(`【${view.spread.name} · ${view.spread.count} 张】`)
  if (view.question !== '') lines.push(`问题：${view.question}`)
  for (let i = 0; i < view.slots.length; i += 1) {
    const slot = view.slots[i]
    const pos = slot.position
    if (slot.card === null) {
      lines.push(`${i + 1}. [${pos.label}] 未抽`)
    } else {
      const side = slot.card.orientation === 'reversed' ? '逆位' : '正位'
      lines.push(`${i + 1}. [${pos.label}] ${slot.card.name}（${side}）— ${slot.card.keywords}`)
      lines.push(`   ↳ ${slot.card.core}`)
    }
  }
  lines.push(`已抽 ${view.picks.length}/${view.spread.count}`)
  return lines.join('\n')
}
