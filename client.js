/**
 * dsh-tarot —— 浏览器半侧（手写 __ModuleLoader__ bundle，不需要构建工具）。
 *
 * 两个界面，共用同一个数据源 /api/tarot/state：
 *   1. 侧边栏常驻入口（sidebar.panellist）+ 主面板（main#tarot）：整张牌桌，
 *      没牌局时是「怎么起局」的引导页，有牌局时是大卡片、牌墙和牌义；
 *   2. 输入框上方的小牌桌（conversation.input.dock）：聊天时随手看一眼，
 *      只在一局进行中出现。
 *
 * 网页端只读：抽牌永远由聊天里的助手发起，这里不写任何数据。
 * 改完用 `node --check client.js` 验证语法。
 */

window.__ModuleLoader__.load({
  id: 'dsh-tarot',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    var NS = 'dsh-tarot'
    var API = '/api/tarot'
    var POLL_MS = 1200

    // ---- 文案 -------------------------------------------------------------

    var ZH = {
      title: '命运牌桌',
      collapse: '收起',
      expand: '展开',
      openPanel: '整张牌桌',
      back: '回到对话',
      awaiting: '在对话里报 {n} 个数字（1–{deck}）',
      partial: '已抽 {got}/{n} · 还差 {left} 张',
      revealed: '牌已全部翻开 · 让助手为你解牌',
      wallTitle: '牌堆 · 1–{deck}',
      wallHint: '报过的号码会亮起来',
      upright: '正位',
      reversed: '逆位',
      noQuestion: '（没有写下问题）',
      emptyTitle: '还没有摆开的牌',
      emptyBody: '在对话里问我一个问题——比如「这段感情还有可能吗」——我会给你摆牌阵，你在 1–78 里报数字，这里就会亮起来。',
      emptyGo: '去对话里问一句',
      spreadsTitle: '可以用的牌阵',
      spreadCount: '{n} 张',
      pageHint: '牌面实时同步：助手抽到哪张，这里就是哪张。',
      tabTable: '牌桌',
      tabArchive: '存档',
      archiveTitle: '牌局存档',
      archiveEmpty: '还没有存下的牌局',
      archiveEmptyBody: '抽满一局之后会自动存进来，解读也会一起保存。',
      archiveLoading: '正在读存档…',
      backList: '返回列表',
      noNote: '这一局还没有写解读。',
      hasNote: '有解读',
      saveHint: '存在本机 ~/.dsh/tarot/history.json',
    }

    var EN = {
      title: 'Tarot Table',
      collapse: 'Collapse',
      expand: 'Expand',
      openPanel: 'Full table',
      back: 'Back to chat',
      awaiting: 'Pick {n} numbers between 1 and {deck} in the chat',
      partial: 'Drawn {got}/{n} · {left} to go',
      revealed: 'All cards are revealed — ask the assistant for the reading',
      wallTitle: 'Deck · 1–{deck}',
      wallHint: 'Picked numbers light up',
      upright: 'Upright',
      reversed: 'Reversed',
      noQuestion: '(no question written)',
      emptyTitle: 'No cards on the table yet',
      emptyBody: 'Ask the assistant a question in the chat — e.g. "is there still a chance for us?" — then call out numbers between 1 and 78. The table lights up here.',
      emptyGo: 'Ask in the chat',
      spreadsTitle: 'Spreads',
      spreadCount: '{n} cards',
      pageHint: 'Live: whenever the assistant draws, this table follows.',
      tabTable: 'Table',
      tabArchive: 'Archive',
      archiveTitle: 'Reading archive',
      archiveEmpty: 'No saved readings yet',
      archiveEmptyBody: 'A reading is archived once all its cards are drawn, together with the interpretation.',
      archiveLoading: 'Loading archive…',
      backList: 'Back to list',
      noNote: 'No interpretation saved for this reading yet.',
      hasNote: 'Has reading',
      saveHint: 'Stored locally at ~/.dsh/tarot/history.json',
    }

    var translate = null
    var layout = null

    /** 取文案；本地化服务没绑上时退回中文，绝不让 UI 变成一堆 key。 */
    function t(key, vars) {
      var text = null
      if (typeof translate === 'function') {
        try {
          text = translate(key)
        } catch (error) {
          text = null
        }
      }
      if (typeof text !== 'string' || text === '' || text === key) {
        text = ZH[key] !== undefined ? ZH[key] : key
      }
      return fill(text, vars)
    }

    function fill(text, vars) {
      if (text === undefined || text === null) return ''
      var out = String(text)
      if (vars !== null && typeof vars === 'object') {
        Object.keys(vars).forEach(function (name) {
          out = out.split('{' + name + '}').join(String(vars[name]))
        })
      }
      return out
    }

    function goPanel(panelId) {
      if (layout === null || layout === undefined || typeof layout.selectPanel !== 'function') return
      try {
        layout.selectPanel(panelId)
      } catch (error) {
        console.error('[dsh-tarot] selectPanel failed', error)
      }
    }

    // ---- 会话 id ----------------------------------------------------------

    /** 槽位给的 sessionId 可能是函数 / 字符串 / {id}，三种都吃。 */
    function readSessionId(props) {
      if (props === null || props === undefined) return ''
      var raw = props.sessionId
      if (typeof raw === 'function') {
        try {
          raw = raw()
        } catch (error) {
          raw = ''
        }
      }
      if (typeof raw === 'string' && raw !== '') return raw
      var session = props.session
      if (typeof session === 'string' && session !== '') return session
      if (session !== null && typeof session === 'object' && typeof session.id === 'string') return session.id
      return ''
    }

    // ---- 拉状态 -----------------------------------------------------------

    /**
     * 拉宿主里的牌局。sessionId 为空时（侧边栏面板）取「最近一局」。
     * 返回 { reading, spreads, ready }。
     */
    function useTable(sessionId) {
      var pair = useState({ reading: null, spreads: [], ready: false })
      var table = pair[0]
      var setTable = pair[1]

      useEffect(function () {
        var alive = true
        var timer = null
        var version = -1
        var controller = null

        function schedule() {
          if (!alive) return
          timer = setTimeout(tick, POLL_MS)
        }

        function tick() {
          if (!alive) return
          if (typeof document !== 'undefined' && document.hidden) {
            schedule()
            return
          }
          if (typeof fetch !== 'function') return

          try {
            if (controller !== null && typeof controller.abort === 'function') controller.abort()
            controller = typeof AbortController === 'function' ? new AbortController() : null
          } catch (error) {
            controller = null
          }

          var query = []
          if (sessionId !== '') query.push('session=' + encodeURIComponent(sessionId))
          if (version >= 0) query.push('since=' + version)
          var url = API + '/state' + (query.length > 0 ? '?' + query.join('&') : '')
          var options = { cache: 'no-store' }
          if (controller !== null) options.signal = controller.signal

          fetch(url, options)
            .then(function (res) {
              return res.ok ? res.json() : null
            })
            .then(function (data) {
              if (!alive || data === null) return
              if (typeof data.v === 'number') version = data.v
              if (data.unchanged === true) return
              setTable({
                reading: data.reading === undefined ? null : data.reading,
                spreads: Array.isArray(data.spreads) ? data.spreads : [],
                ready: true,
              })
            })
            .catch(function () {
              /* 宿主不在就先安静等下一轮 */
            })
            .then(schedule, schedule)
        }

        tick()

        function onVisible() {
          if (typeof document === 'undefined' || document.hidden) return
          if (timer !== null) clearTimeout(timer)
          timer = null
          tick()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)

        return function () {
          alive = false
          if (timer !== null) clearTimeout(timer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
          if (controller !== null && typeof controller.abort === 'function') controller.abort()
        }
      }, [sessionId])

      return table
    }

    // ---- 牌面图形 ---------------------------------------------------------

    var SUIT_GLYPH = {
      wands: [
        h('path', { key: 'flame', d: 'M12 2.2c2.1 2.7 3.3 5 3.3 7.1 0 2.3-1.4 3.9-3.3 3.9s-3.3-1.6-3.3-3.9c0-2.1 1.2-4.4 3.3-7.1Z' }),
        h('rect', { key: 'staff', x: '11.1', y: '12.6', width: '1.8', height: '9', rx: '0.9' }),
      ],
      cups: [
        h('path', { key: 'bowl', d: 'M5.4 4.2h13.2a6.6 6.6 0 0 1-13.2 0Z' }),
        h('rect', { key: 'stem', x: '11.2', y: '10.4', width: '1.6', height: '7.4', rx: '0.8' }),
        h('rect', { key: 'base', x: '7.8', y: '17.6', width: '8.4', height: '1.7', rx: '0.85' }),
      ],
      swords: [
        h('path', { key: 'blade', d: 'M12 1.8 14 13.4h-4L12 1.8Z' }),
        h('rect', { key: 'guard', x: '6.6', y: '13.1', width: '10.8', height: '1.7', rx: '0.85' }),
        h('rect', { key: 'grip', x: '11.2', y: '14.6', width: '1.6', height: '5.4', rx: '0.8' }),
        h('rect', { key: 'pommel', x: '9.6', y: '19.6', width: '4.8', height: '1.8', rx: '0.9' }),
      ],
      pentacles: [
        h('path', {
          key: 'star',
          d: 'M12 4.2 13.7 9.1 18.9 9.3 14.8 12.5 16.3 17.5 12 14.6 7.7 17.5 9.2 12.5 5.1 9.3 10.3 9.1Z',
        }),
        h('circle', { key: 'ring', cx: '12', cy: '11.6', r: '8.9', fill: 'none', stroke: 'currentColor', strokeWidth: '1.3' }),
      ],
    }

    function SuitIcon(props) {
      var suit = props.suit
      var size = props.size || 12
      var glyph = SUIT_GLYPH[suit]
      if (glyph === undefined) glyph = SUIT_GLYPH.pentacles
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          className: 'trt-suit trt-suit-' + String(suit),
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('g', { fill: 'currentColor' }, glyph),
      )
    }

    var RANK_LETTER = { page: 'P', knight: 'N', queen: 'Q', king: 'K' }

    function rankLabel(rank) {
      if (rank === 'a') return 'A'
      if (RANK_LETTER[rank] !== undefined) return RANK_LETTER[rank]
      return String(rank)
    }

    /** 小阿卡纳：1–10 用花色点数，宫廷牌用字母 + 大花色。 */
    function Pips(props) {
      var card = props.card
      var big = props.big === true
      var rank = card.rank
      var letter = RANK_LETTER[rank]
      if (letter !== undefined) {
        return h(
          'div',
          { className: 'trt-court' },
          h(SuitIcon, { suit: card.suit, size: big ? 34 : 26 }),
          h('span', { className: 'trt-court-letter' }, letter),
        )
      }
      var n = rank === 'a' ? 1 : Number(rank)
      if (!isFinite(n) || n < 1) n = 1
      var size = big ? (n > 6 ? 12 : 16) : n > 6 ? 9 : 12
      var pips = []
      for (var i = 0; i < n; i += 1) pips.push(h(SuitIcon, { key: i, suit: card.suit, size: size }))
      return h('div', { className: 'trt-pips trt-pips-' + Math.min(n, 10) }, pips)
    }

    /** 一张牌的正面。 */
    function CardArt(props) {
      var card = props.card
      var big = props.big === true
      var major = card.arcana === 'major'
      var reversed = card.orientation === 'reversed'
      return h(
        'div',
        { className: 'trt-art' + (reversed ? ' trt-art-rev' : '') },
        h('span', { className: 'trt-art-corner' }, major ? card.roman || '' : rankLabel(card.rank)),
        h(
          'div',
          { className: 'trt-emblem' },
          major ? h('span', { className: 'trt-glyph' }, card.sym || '✦') : h(Pips, { card: card, big: big }),
        ),
        h('span', { className: 'trt-art-name' }, card.name),
        reversed ? h('span', { className: 'trt-rev' }, t('reversed')) : null,
      )
    }

    /** 背面（空桌插画用）。 */
    function CardBack() {
      return h('div', { className: 'trt-back', 'aria-hidden': 'true' }, h('span', { className: 'trt-back-star' }, '✦'))
    }

    /** 一个位置：盖牌 / 明牌 + 位置名 + 牌名 + 关键词。 */
    function Slot(props) {
      var slot = props.slot
      var index = props.index
      var big = props.big === true
      var card = slot.card
      var label = slot.position !== null && slot.position !== undefined ? slot.position.label : ''
      var hint = slot.position !== null && slot.position !== undefined ? slot.position.hint : ''

      return h(
        'div',
        {
          className: 'trt-slot' + (big ? ' trt-slot-lg' : '') + (card === null ? ' trt-slot-empty' : ''),
          style: card === null ? undefined : { animationDelay: index * 85 + 'ms' },
        },
        h(
          'div',
          { className: 'trt-card' + (big ? ' trt-card-lg' : '') },
          card === null ? h('span', { className: 'trt-qmark' }, '?') : h(CardArt, { card: card, big: big }),
          h('span', { className: 'trt-ord' }, String(index + 1)),
        ),
        h('span', { className: 'trt-pos' }, label),
        card === null
          ? hint !== ''
            ? h('span', { className: 'trt-kw trt-kw-empty' }, hint)
            : null
          : h(
              'span',
              { className: 'trt-meta' },
              h('span', { className: 'trt-name' }, card.name),
              h(
                'span',
                { className: 'trt-tag' + (card.orientation === 'reversed' ? ' trt-tag-rev' : '') },
                card.orientation === 'reversed' ? t('reversed') : t('upright'),
              ),
            ),
        card === null ? null : h('span', { className: 'trt-kw' }, card.keywords || ''),
      )
    }

    /** 78 张盖着的牌墙，抽过的号码亮起来。 */
    function DeckWall(props) {
      var deck = props.deck || 78
      var picked = props.picked || []
      var wide = props.wide === true
      var taken = {}
      for (var p = 0; p < picked.length; p += 1) taken[picked[p]] = true
      var tiles = []
      for (var i = 1; i <= deck; i += 1) {
        tiles.push(h('span', { key: i, className: 'trt-tile' + (taken[i] === true ? ' trt-tile-pick' : '') }, String(i)))
      }
      return h(
        'div',
        { className: 'trt-wallwrap' + (wide ? ' trt-wallwrap-wide' : '') },
        h(
          'div',
          { className: 'trt-wallhd' },
          h('span', { className: 'trt-walltitle' }, t('wallTitle', { deck: deck })),
          h('span', { className: 'trt-wallhint' }, t('wallHint')),
        ),
        h('div', { className: 'trt-wall' + (wide ? ' trt-wall-wide' : '') }, tiles),
      )
    }

    function statusText(reading, spread, picks) {
      var count = typeof spread.count === 'number' ? spread.count : 0
      var left = Math.max(0, count - picks.length)
      if (reading.status === 'revealed') return t('revealed')
      if (reading.status === 'partial') return t('partial', { got: picks.length, n: count, left: left })
      return t('awaiting', { n: count, deck: reading.deckSize || 78 })
    }

    /** 「11月6日 00:10」；解析不了就回显原值。 */
    function whenLabel(iso) {
      var date = new Date(iso)
      if (isNaN(date.getTime())) return typeof iso === 'string' ? iso : ''
      var pad = function (n) {
        return n < 10 ? '0' + n : String(n)
      }
      return date.getMonth() + 1 + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    // ---- 主面板（侧边栏常驻）----------------------------------------------

    function TarotPanel() {
      var table = useTable('')
      var tabState = useState('table')
      var tab = tabState[0]
      var setTab = tabState[1]
      var histState = useState(null)
      var history = histState[0]
      var setHistory = histState[1]
      var selState = useState(null)
      var selected = selState[0]
      var setSelected = selState[1]

      useEffect(function () {
        if (tab !== 'archive') return undefined
        if (typeof fetch !== 'function') return undefined
        var alive = true
        fetch(API + '/history', { cache: 'no-store' })
          .then(function (res) {
            return res.ok ? res.json() : null
          })
          .then(function (data) {
            if (alive && data !== null && Array.isArray(data.entries)) setHistory(data.entries)
          })
          .catch(function () {})
        return function () {
          alive = false
        }
      }, [tab])

      try {
        var reading = table.reading
        var archiveCount = history === null ? '' : ' ' + history.length
        return h(
          'div',
          { className: 'trt-page' },
          h(
            'div',
            { className: 'trt-page-in' },
            h(
              'header',
              { className: 'trt-page-hd' },
              h(
                'div',
                { className: 'trt-grow' },
                h(
                  'div',
                  { className: 'trt-page-title' },
                  h('span', { className: 'trt-spark', 'aria-hidden': 'true' }, '✦'),
                  h('span', null, t('title')),
                ),
                h('div', { className: 'trt-page-sub' }, t('pageHint')),
              ),
              h(
                'div',
                { className: 'trt-tabs', role: 'tablist' },
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'tab',
                    className: 'trt-tab' + (tab === 'table' ? ' trt-tab-on' : ''),
                    'aria-selected': tab === 'table' ? 'true' : 'false',
                    onClick: function () {
                      setTab('table')
                      setSelected(null)
                    },
                  },
                  t('tabTable'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'tab',
                    className: 'trt-tab' + (tab === 'archive' ? ' trt-tab-on' : ''),
                    'aria-selected': tab === 'archive' ? 'true' : 'false',
                    onClick: function () {
                      setTab('archive')
                    },
                  },
                  t('tabArchive') + archiveCount,
                ),
              ),
              h(
                'button',
                { type: 'button', className: 'trt-ghost', onClick: function () { goPanel('conversation') } },
                t('back'),
              ),
            ),
            tab === 'archive'
              ? h(ArchiveView, {
                  entries: history,
                  selected: selected,
                  onSelect: setSelected,
                })
              : reading === null || reading === undefined
                ? h(EmptyTable, { spreads: table.spreads })
                : h(BigBoard, { reading: reading }),
          ),
        )
      } catch (error) {
        console.error('[dsh-tarot] panel render failed', error)
        return null
      }
    }

    // ---- 存档 -------------------------------------------------------------

    function ArchiveView(props) {
      var entries = props.entries
      var selected = props.selected
      var onSelect = props.onSelect

      if (selected !== null && selected !== undefined) {
        var entry = null
        if (Array.isArray(entries)) {
          for (var i = 0; i < entries.length; i += 1) {
            if (entries[i].id === selected) entry = entries[i]
          }
        }
        if (entry === null) {
          return h(
            'div',
            { className: 'trt-empty' },
            h('p', { className: 'trt-empty-body' }, t('archiveLoading')),
          )
        }
        return h(ArchiveDetail, {
          entry: entry,
          onBack: function () {
            onSelect(null)
          },
        })
      }

      if (entries === null) {
        return h('div', { className: 'trt-empty' }, h('p', { className: 'trt-empty-body' }, t('archiveLoading')))
      }

      if (entries.length === 0) {
        return h(
          'div',
          { className: 'trt-empty' },
          h(
            'div',
            { className: 'trt-fan', 'aria-hidden': 'true' },
            h('div', { className: 'trt-fan-card trt-fan-l' }, h(CardBack, null)),
            h('div', { className: 'trt-fan-card trt-fan-c' }, h(CardBack, null)),
            h('div', { className: 'trt-fan-card trt-fan-r' }, h(CardBack, null)),
          ),
          h('h2', { className: 'trt-empty-title' }, t('archiveEmpty')),
          h('p', { className: 'trt-empty-body' }, t('archiveEmptyBody')),
        )
      }

      return h(
        'div',
        { className: 'trt-archwrap' },
        h('div', { className: 'trt-spreads-title' }, t('archiveTitle') + ' · ' + entries.length),
        h(
          'div',
          { className: 'trt-archlist' },
          entries.map(function (entry) {
            return h(ArchiveItem, {
              key: entry.id,
              entry: entry,
              onOpen: function () {
                onSelect(entry.id)
              },
            })
          }),
        ),
      )
    }

    function ArchiveItem(props) {
      var entry = props.entry
      var cards = Array.isArray(entry.cards) ? entry.cards : []
      var spreadName = entry.spread !== null && typeof entry.spread === 'object' ? entry.spread.name : ''
      return h(
        'button',
        { type: 'button', className: 'trt-architem', onClick: props.onOpen },
        h('span', { className: 'trt-archq' }, entry.question || t('noQuestion')),
        h(
          'span',
          { className: 'trt-archmeta' },
          h('span', null, whenLabel(entry.createdAt)),
          spreadName !== '' ? h('span', null, spreadName) : null,
          h('span', null, t('spreadCount', { n: cards.length })),
          entry.note ? h('span', { className: 'trt-hasnote' }, t('hasNote')) : null,
        ),
        h(
          'span',
          { className: 'trt-archcards' },
          cards
            .map(function (card) {
              return card.name + (card.orientation === 'reversed' ? '逆' : '')
            })
            .join(' · '),
        ),
      )
    }

    function ArchiveDetail(props) {
      var entry = props.entry
      var cards = Array.isArray(entry.cards) ? entry.cards : []
      var spreadName = entry.spread !== null && typeof entry.spread === 'object' ? entry.spread.name : ''
      return h(
        'div',
        { className: 'trt-board' },
        h(
          'div',
          { className: 'trt-boardq' },
          h(
            'button',
            { type: 'button', className: 'trt-ghost', onClick: props.onBack },
            '← ' + t('backList'),
          ),
          h('span', { className: 'trt-quote' }, entry.question ? '「' + entry.question + '」' : t('noQuestion')),
          h('span', { className: 'trt-grow' }),
          h('span', { className: 'trt-status' }, whenLabel(entry.createdAt) + (spreadName !== '' ? ' · ' + spreadName : '')),
        ),
        h(
          'div',
          { className: 'trt-row trt-row-lg' },
          cards.map(function (card, index) {
            return h(
              'div',
              { className: 'trt-slot trt-slot-lg', key: 'card' + index },
              h('div', { className: 'trt-card trt-card-lg' }, h(CardArt, { card: card, big: true })),
              h('span', { className: 'trt-pos' }, card.position || ''),
              h(
                'span',
                { className: 'trt-meta' },
                h('span', { className: 'trt-name' }, card.name),
                h(
                  'span',
                  { className: 'trt-tag' + (card.orientation === 'reversed' ? ' trt-tag-rev' : '') },
                  card.orientation === 'reversed' ? t('reversed') : t('upright'),
                ),
              ),
              h('span', { className: 'trt-kw' }, card.keywords || ''),
            )
          }),
        ),
        entry.note
          ? h('div', { className: 'trt-note' }, entry.note)
          : h('div', { className: 'trt-note trt-note-empty' }, t('noNote')),
      )
    }

    function EmptyTable(props) {
      var spreads = props.spreads || []
      return h(
        'div',
        { className: 'trt-empty' },
        h(
          'div',
          { className: 'trt-fan', 'aria-hidden': 'true' },
          h('div', { className: 'trt-fan-card trt-fan-l' }, h(CardBack, null)),
          h('div', { className: 'trt-fan-card trt-fan-c' }, h(CardBack, null)),
          h('div', { className: 'trt-fan-card trt-fan-r' }, h(CardBack, null)),
        ),
        h('h2', { className: 'trt-empty-title' }, t('emptyTitle')),
        h('p', { className: 'trt-empty-body' }, t('emptyBody')),
        h(
          'button',
          { type: 'button', className: 'trt-primary', onClick: function () { goPanel('conversation') } },
          t('emptyGo'),
        ),
        spreads.length > 0
          ? h(
              'div',
              { className: 'trt-spreads' },
              h('div', { className: 'trt-spreads-title' }, t('spreadsTitle')),
              h(
                'div',
                { className: 'trt-spreadgrid' },
                spreads.map(function (spread) {
                  return h(
                    'div',
                    { className: 'trt-spreadcard', key: spread.key },
                    h(
                      'div',
                      { className: 'trt-spreadcard-hd' },
                      h('span', { className: 'trt-spreadcard-name' }, spread.name),
                      h('span', { className: 'trt-pill' }, t('spreadCount', { n: spread.count })),
                    ),
                    h('div', { className: 'trt-spreadcard-desc' }, spread.desc || ''),
                    h(
                      'div',
                      { className: 'trt-spreadcard-pos' },
                      (spread.positions || []).map(function (pos) {
                        return h('span', { className: 'trt-poschip', key: pos.label }, pos.label)
                      }),
                    ),
                  )
                }),
              ),
            )
          : null,
      )
    }

    function BigBoard(props) {
      var reading = props.reading
      var slots = Array.isArray(reading.slots) ? reading.slots : []
      var spread = reading.spread !== null && typeof reading.spread === 'object' ? reading.spread : {}
      var picks = Array.isArray(reading.picks) ? reading.picks : []
      var count = typeof spread.count === 'number' ? spread.count : slots.length
      var dots = []
      for (var d = 0; d < count; d += 1) {
        dots.push(h('span', { key: d, className: 'trt-dot' + (d < picks.length ? ' trt-dot-on' : '') }))
      }

      return h(
        'div',
        { className: 'trt-board' },
        h(
          'div',
          { className: 'trt-boardq' },
          h('span', { className: 'trt-kicker' }, spread.name || ''),
          h('span', { className: 'trt-quote' }, reading.question ? '「' + reading.question + '」' : t('noQuestion')),
          h('span', { className: 'trt-grow' }),
          h('span', { className: 'trt-dots' }, dots),
          h('span', { className: 'trt-status' }, statusText(reading, spread, picks)),
        ),
        h(
          'div',
          { className: 'trt-row trt-row-lg' },
          slots.map(function (slot, index) {
            return h(Slot, { key: 'slot' + index, slot: slot, index: index, big: true })
          }),
        ),
        reading.status === 'revealed' ? null : h(DeckWall, { deck: reading.deckSize || 78, picked: picks, wide: true }),
        reading.status === 'revealed'
          ? h(
              'div',
              { className: 'trt-boardft' },
              picks.map(function (n) {
                return h('span', { className: 'trt-chip', key: 'pick' + n }, '#' + n)
              }),
            )
          : null,
      )
    }

    // ---- 输入框上方的小牌桌 ------------------------------------------------

    function TarotDock(props) {
      var sessionId = readSessionId(props)
      var table = useTable(sessionId)
      var collapsedState = useState(false)
      var collapsed = collapsedState[0]
      var setCollapsed = collapsedState[1]

      var reading = table.reading
      if (reading === null || reading === undefined) return null

      try {
        var slots = Array.isArray(reading.slots) ? reading.slots : []
        var spread = reading.spread !== null && typeof reading.spread === 'object' ? reading.spread : {}
        var picks = Array.isArray(reading.picks) ? reading.picks : []
        var count = typeof spread.count === 'number' ? spread.count : slots.length
        var dots = []
        for (var d = 0; d < count; d += 1) {
          dots.push(h('span', { key: d, className: 'trt-dot' + (d < picks.length ? ' trt-dot-on' : '') }))
        }
        var chips = picks.map(function (n) {
          return h('span', { key: 'pick' + n, className: 'trt-chip' }, '#' + n)
        })

        return h(
          'section',
          { className: 'trt' + (collapsed ? ' trt-min' : ''), 'data-dsh-tarot': '' },
          h(
            'header',
            { className: 'trt-hd' },
            h('span', { className: 'trt-spark', 'aria-hidden': 'true' }, '✦'),
            h('span', { className: 'trt-title' }, t('title')),
            h('span', { className: 'trt-badge' }, spread.name || ''),
            h('span', { className: 'trt-rule' }),
            h(
              'button',
              { type: 'button', className: 'trt-btn', title: t('openPanel'), onClick: function () { goPanel('tarot') } },
              t('openPanel'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'trt-btn',
                'aria-expanded': collapsed ? 'false' : 'true',
                onClick: function () {
                  setCollapsed(!collapsed)
                },
              },
              collapsed ? t('expand') : t('collapse'),
            ),
          ),
          collapsed
            ? null
            : h(
                'div',
                { className: 'trt-body' },
                reading.question ? h('p', { className: 'trt-q' }, '「' + reading.question + '」') : null,
                h(
                  'div',
                  { className: 'trt-row' },
                  slots.map(function (slot, index) {
                    return h(Slot, { key: 'slot' + index, slot: slot, index: index })
                  }),
                ),
                reading.status === 'revealed' ? null : h(DeckWall, { deck: reading.deckSize || 78, picked: picks }),
                h(
                  'div',
                  { className: 'trt-ft' },
                  h('span', { className: 'trt-dots' }, dots),
                  h('span', { className: 'trt-status' }, statusText(reading, spread, picks)),
                  chips.length > 0 ? h('span', { className: 'trt-chips' }, chips) : null,
                ),
              ),
        )
      } catch (error) {
        console.error('[dsh-tarot] dock render failed', error)
        return null
      }
    }

    // ---- 侧边栏图标 -------------------------------------------------------

    function TarotIcon(props) {
      var size = typeof props.size === 'number' && props.size > 0 ? props.size : 20
      var active = props.active === true
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block', opacity: active ? 1 : 0.9 },
        },
        h('rect', {
          x: '5.6',
          y: '3.4',
          width: '12.8',
          height: '17.2',
          rx: '2.4',
          stroke: 'currentColor',
          strokeWidth: '1.5',
        }),
        h('path', {
          d: 'M12 6.9l1.1 2.35 2.35 1.1-2.35 1.1L12 13.8l-1.1-2.35L8.55 10.35l2.35-1.1z',
          fill: 'currentColor',
        }),
        h('circle', { cx: '12', cy: '17.2', r: '0.95', fill: 'currentColor', opacity: '0.55' }),
      )
    }

    // ---- 样式 -------------------------------------------------------------

    var STYLE = [
      // 公共
      '.trt-spark{color:#c9a24a;font-size:13px;text-shadow:0 0 10px rgba(201,162,74,.55);}',
      '.trt-grow{flex:1 1 auto;min-width:0;}',
      '.trt-rule{flex:1 1 auto;height:1px;min-width:12px;background:linear-gradient(90deg,var(--dsw-alias-border-l1),transparent);}',
      '.trt-btn{font:inherit;font-size:11.5px;line-height:1;padding:5px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s,background .15s;}',
      '.trt-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);}',
      '.trt-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.trt-ghost{font:inherit;font-size:12.5px;line-height:1;padding:8px 14px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;}',
      '.trt-ghost:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);}',
      '.trt-primary{font:inherit;font-size:13px;line-height:1;padding:10px 18px;border-radius:10px;border:1px solid rgba(201,162,74,.55);background:linear-gradient(180deg,rgba(201,162,74,.22),rgba(140,105,25,.14));color:var(--dsw-alias-label-primary);cursor:pointer;}',
      '.trt-primary:hover{border-color:rgba(201,162,74,.85);}',
      '.trt-pill{font-size:11px;line-height:1;padding:3px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
      '.trt-poschip{font-size:10.5px;line-height:1;padding:3px 7px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-secondary);}',

      // 牌桌（dock）
      '.trt{position:relative;margin:0 0 10px;border-radius:16px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;box-shadow:0 18px 40px -34px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.05);isolation:isolate;}',
      '.trt::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(120% 100% at 50% -40%,rgba(196,162,74,.16),transparent 62%),radial-gradient(60% 60% at 100% 120%,rgba(112,86,160,.14),transparent 70%);}',
      '.trt::after{content:"";position:absolute;left:10%;right:10%;top:0;height:1px;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(196,162,74,.55),transparent);}',
      '.trt-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;min-height:38px;}',
      '.trt-title{font-weight:600;letter-spacing:.08em;font-size:12.5px;}',
      '.trt-badge{font-size:11.5px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px;white-space:nowrap;}',
      '.trt-body{display:flex;flex-direction:column;gap:10px;padding:0 12px 12px;}',
      '.trt-q{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary);border-left:2px solid rgba(196,162,74,.5);padding-left:8px;}',
      '.trt-row{display:flex;flex-wrap:wrap;gap:10px 8px;justify-content:center;}',
      '.trt-slot{width:84px;display:flex;flex-direction:column;align-items:center;gap:4px;animation:trt-rise .38s cubic-bezier(.2,.7,.3,1) both;}',
      '@keyframes trt-rise{from{opacity:0;transform:translateY(6px) scale(.96);}to{opacity:1;transform:none;}}',
      '.trt-card{position:relative;width:66px;height:100px;border-radius:7px;overflow:hidden;box-shadow:0 6px 14px -10px rgba(0,0,0,.8);}',
      '.trt-slot-empty .trt-card{border:1px dashed color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);display:flex;align-items:center;justify-content:center;box-shadow:none;}',
      '.trt-qmark{font-size:24px;color:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent);font-family:Georgia,"Times New Roman",serif;}',
      '.trt-ord{position:absolute;right:4px;bottom:3px;font-size:9px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary);opacity:.65;}',
      '.trt-art{position:absolute;inset:0;background:linear-gradient(158deg,#fbf6e8 0%,#f3e9d2 46%,#e6d7b6 100%);border:1px solid rgba(126,99,42,.4);border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:4px 3px 3px;color:#2c2418;}',
      '.trt-art::after{content:"";position:absolute;inset:2px;border:1px solid rgba(138,106,31,.35);border-radius:5px;pointer-events:none;}',
      '.trt-art-corner{font-size:9px;letter-spacing:.06em;font-family:Georgia,"Times New Roman",serif;color:#7d5f1c;align-self:flex-start;line-height:1;}',
      '.trt-emblem{flex:1 1 auto;display:flex;align-items:center;justify-content:center;width:100%;transition:transform .45s cubic-bezier(.2,.7,.3,1);}',
      '.trt-art-rev .trt-emblem{transform:rotate(180deg);}',
      '.trt-glyph{font-size:26px;line-height:1;color:#7d5f1c;text-shadow:0 1px 0 rgba(255,255,255,.6);}',
      '.trt-art-name{font-size:8.5px;line-height:1.1;letter-spacing:.02em;text-align:center;color:#4a3a1c;max-width:100%;}',
      '.trt-rev{position:absolute;top:3px;right:3px;font-size:8px;line-height:1;padding:2px 3px;border-radius:3px;background:rgba(140,47,37,.9);color:#f7e9c8;letter-spacing:.04em;}',
      '.trt-pips{display:grid;grid-template-columns:repeat(3,auto);gap:2px;justify-content:center;align-content:center;}',
      '.trt-pips-1{grid-template-columns:auto;}',
      '.trt-pips-2{grid-template-columns:repeat(2,auto);}',
      '.trt-pips-4{grid-template-columns:repeat(2,auto);}',
      '.trt-suit{display:block;}',
      '.trt-suit-wands{color:#a85a1c;}',
      '.trt-suit-cups{color:#2f7386;}',
      '.trt-suit-swords{color:#5b6472;}',
      '.trt-suit-pentacles{color:#8a6a1c;}',
      '.trt-court{display:flex;flex-direction:column;align-items:center;gap:1px;}',
      '.trt-court-letter{font-size:9px;letter-spacing:.08em;color:#7d5f1c;font-family:Georgia,"Times New Roman",serif;}',
      '.trt-pos{font-size:10.5px;color:var(--dsw-alias-label-secondary);text-align:center;line-height:1.25;max-width:100%;}',
      '.trt-meta{display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap;}',
      '.trt-name{font-size:11px;font-weight:600;letter-spacing:.02em;}',
      '.trt-tag{font-size:9px;line-height:1;padding:2px 4px;border-radius:3px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);}',
      '.trt-tag-rev{border-color:rgba(140,47,37,.55);color:#a8452f;}',
      '.trt-kw{font-size:9.5px;line-height:1.35;color:var(--dsw-alias-label-secondary);text-align:center;max-width:84px;}',
      '.trt-kw-empty{opacity:.62;}',
      '.trt-wallwrap{border-top:1px dashed var(--dsw-alias-border-l1);padding-top:8px;display:flex;flex-direction:column;gap:6px;}',
      '.trt-wallhd{display:flex;align-items:baseline;gap:8px;}',
      '.trt-walltitle{font-size:11px;letter-spacing:.06em;color:var(--dsw-alias-label-secondary);}',
      '.trt-wallhint{font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.65;}',
      '.trt-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(24px,1fr));gap:3px;}',
      '.trt-tile{height:22px;display:flex;align-items:center;justify-content:center;font-size:9.5px;font-variant-numeric:tabular-nums;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);color:var(--dsw-alias-label-secondary);}',
      '.trt-tile-pick{color:#f4e3b0;border-color:rgba(201,162,74,.8);background:linear-gradient(180deg,rgba(201,162,74,.42),rgba(120,90,20,.28));box-shadow:0 0 12px -4px rgba(201,162,74,.8);}',
      '.trt-ft{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:8px;}',
      '.trt-status{font-size:11.5px;color:var(--dsw-alias-label-secondary);}',
      '.trt-dots{display:inline-flex;gap:4px;}',
      '.trt-dot{width:5px;height:5px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);}',
      '.trt-dot-on{background:#c9a24a;box-shadow:0 0 6px rgba(201,162,74,.7);}',
      '.trt-chips{display:inline-flex;gap:4px;flex-wrap:wrap;margin-left:auto;}',
      '.trt-chip{font-size:10px;line-height:1;padding:3px 5px;border-radius:4px;border:1px solid rgba(201,162,74,.45);color:#b3903c;}',
      '.trt-min .trt-body{display:none;}',

      // 大卡片
      '.trt-slot-lg{width:118px;gap:6px;}',
      '.trt-card-lg{width:96px;height:146px;border-radius:9px;}',
      '.trt-card-lg .trt-art{padding:6px 5px 5px;border-radius:9px;}',
      '.trt-card-lg .trt-art::after{inset:3px;border-radius:6px;}',
      '.trt-card-lg .trt-art-corner{font-size:11px;}',
      '.trt-card-lg .trt-glyph{font-size:38px;}',
      '.trt-card-lg .trt-art-name{font-size:10.5px;}',
      '.trt-card-lg .trt-rev{font-size:9px;padding:2px 4px;}',
      '.trt-card-lg .trt-ord{font-size:10px;right:5px;bottom:4px;}',
      '.trt-slot-lg .trt-pos{font-size:12px;}',
      '.trt-slot-lg .trt-name{font-size:13px;}',
      '.trt-slot-lg .trt-tag{font-size:10px;padding:2px 5px;}',
      '.trt-slot-lg .trt-kw{font-size:11px;max-width:118px;line-height:1.45;}',

      // 牌背
      '.trt-back{position:absolute;inset:0;border-radius:7px;background:linear-gradient(160deg,#2b2147 0%,#191330 52%,#241a3d 100%);border:1px solid rgba(201,162,74,.55);display:flex;align-items:center;justify-content:center;overflow:hidden;}',
      '.trt-back::before{content:"";position:absolute;inset:4px;border:1px solid rgba(201,162,74,.32);border-radius:4px;}',
      '.trt-back::after{content:"";position:absolute;inset:-30%;background:conic-gradient(from 0deg,rgba(201,162,74,.12) 0deg 4deg,transparent 4deg 16deg);border-radius:50%;}',
      '.trt-back-star{position:relative;z-index:1;font-size:22px;color:#d8b45a;text-shadow:0 0 14px rgba(201,162,74,.75);}',

      // 页面
      '.trt-page{display:block;min-height:100%;max-height:100%;overflow-y:auto;padding:26px 30px 56px;color:var(--dsw-alias-label-primary);}',
      '.trt-page-in{max-width:1060px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}',
      '.trt-page-hd{display:flex;align-items:flex-start;gap:16px;}',
      '.trt-page-title{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:600;letter-spacing:.08em;}',
      '.trt-page-sub{font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-top:5px;}',

      // 空桌
      '.trt-empty{position:relative;border:1px solid var(--dsw-alias-border-l1);border-radius:20px;padding:40px 26px 30px;text-align:center;background:radial-gradient(120% 120% at 50% -20%,rgba(201,162,74,.13),transparent 60%),radial-gradient(90% 90% at 50% 130%,rgba(112,86,160,.12),transparent 65%),var(--dsw-alias-bg-layer-1);overflow:hidden;}',
      '.trt-fan{position:relative;height:150px;margin:0 auto 18px;width:230px;}',
      '.trt-fan-card{position:absolute;left:50%;top:8px;width:88px;height:134px;margin-left:-44px;border-radius:9px;box-shadow:0 18px 30px -22px rgba(0,0,0,.9);}',
      '.trt-fan-l{transform:rotate(-13deg) translate(-46px,6px);}',
      '.trt-fan-c{transform:translateY(-2px);z-index:1;}',
      '.trt-fan-r{transform:rotate(13deg) translate(46px,6px);}',
      '.trt-empty-title{margin:0 0 10px;font-size:16px;font-weight:600;letter-spacing:.04em;}',
      '.trt-empty-body{margin:0 auto 20px;max-width:520px;font-size:13px;line-height:1.75;color:var(--dsw-alias-label-secondary);}',
      '.trt-spreads{margin-top:34px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:20px;text-align:left;}',
      '.trt-spreads-title{font-size:12px;letter-spacing:.1em;color:var(--dsw-alias-label-secondary);margin-bottom:12px;}',
      '.trt-spreadgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;}',
      '.trt-spreadcard{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 13px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);display:flex;flex-direction:column;gap:7px;}',
      '.trt-spreadcard-hd{display:flex;align-items:center;gap:8px;}',
      '.trt-spreadcard-name{font-size:13px;font-weight:600;}',
      '.trt-spreadcard-desc{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);}',
      '.trt-spreadcard-pos{display:flex;flex-wrap:wrap;gap:4px;}',

      // 牌局
      '.trt-board{border:1px solid var(--dsw-alias-border-l1);border-radius:20px;padding:22px 22px 18px;display:flex;flex-direction:column;gap:20px;background:radial-gradient(120% 100% at 50% -30%,rgba(201,162,74,.14),transparent 60%),radial-gradient(80% 80% at 100% 120%,rgba(112,86,160,.12),transparent 70%),var(--dsw-alias-bg-layer-1);}',
      '.trt-boardq{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}',
      '.trt-kicker{font-size:11px;letter-spacing:.14em;color:#b3903c;}',
      '.trt-quote{font-size:14px;color:var(--dsw-alias-label-primary);}',
      '.trt-row-lg{gap:20px 14px;}',
      '.trt-wallwrap-wide{max-width:760px;margin:0 auto;width:100%;}',
      '.trt-wall-wide{grid-template-columns:repeat(auto-fill,minmax(28px,1fr));}',
      '.trt-wall-wide .trt-tile{height:26px;font-size:10px;}',
      '.trt-boardft{display:flex;gap:5px;flex-wrap:wrap;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:12px;}',

      // 页签
      '.trt-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);}',
      '.trt-tab{font:inherit;font-size:12.5px;line-height:1;padding:6px 14px;border-radius:999px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;}',
      '.trt-tab:hover{color:var(--dsw-alias-label-primary);}',
      '.trt-tab-on,.trt-tab-on:hover{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.14);}',

      // 存档
      '.trt-archwrap{display:flex;flex-direction:column;gap:10px;}',
      '.trt-archlist{display:flex;flex-direction:column;gap:8px;}',
      '.trt-architem{font:inherit;width:100%;text-align:left;display:flex;flex-direction:column;gap:6px;padding:13px 15px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer;transition:border-color .15s,background .15s;}',
      '.trt-architem:hover{border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--dsw-alias-bg-layer-1));}',
      '.trt-architem:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.trt-archq{font-size:13.5px;font-weight:600;line-height:1.45;}',
      '.trt-archmeta{display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-secondary);}',
      '.trt-archcards{font-size:11.5px;color:var(--dsw-alias-label-secondary);opacity:.8;letter-spacing:.02em;}',
      '.trt-hasnote{color:#b3903c;border:1px solid rgba(201,162,74,.45);border-radius:999px;padding:0 7px;}',
      '.trt-note{white-space:pre-wrap;word-break:break-word;font-size:13.5px;line-height:1.9;color:var(--dsw-alias-label-primary);border-top:1px dashed var(--dsw-alias-border-l1);padding-top:16px;}',
      '.trt-note-empty{color:var(--dsw-alias-label-secondary);}',

      '@media (max-width:560px){.trt-slot{width:72px;}.trt-card{width:58px;height:88px;}}',
      '@media (prefers-reduced-motion:reduce){.trt-slot{animation:none;}.trt-emblem{transition:none;}}',
    ].join('')

    // ---- 注册 -------------------------------------------------------------

    function start(ctx) {
      try {
        translate = ctx.locale.bind(NS)
      } catch (error) {
        translate = null
      }
      try {
        layout = ctx.layout || ctx.get('layout') || null
      } catch (error) {
        try {
          layout = ctx.get('layout') || null
        } catch (inner) {
          layout = null
        }
      }

      ctx.effect(function () {
        try {
          ctx.locale.register(NS, 'zh', ZH)
          ctx.locale.register(NS, 'zh-CN', ZH)
          ctx.locale.register(NS, 'en', EN)
        } catch (error) {
          console.error('[dsh-tarot] locale register failed', error)
        }
        return function () {}
      }, 'dsh-tarot: dictionaries')

      ctx.effect(function () {
        var el = document.createElement('style')
        el.setAttribute('data-dsh-tarot', '')
        el.textContent = STYLE
        document.head.appendChild(el)
        return function () {
          if (el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, 'dsh-tarot: styles')

      // 侧边栏常驻入口：id 同时也是 main 面板的 key，点击由侧边栏自己处理。
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'tarot',
            order: 20,
            label: function () {
              return t('title')
            },
          },
          TarotIcon,
        )
      })

      // 主面板：整张牌桌（没有会话绑定，显示「最近一局」）。
      ctx.slots.inject('main', function () {
        return ctx.slots.register(
          {
            name: 'main',
            key: 'tarot',
          },
          TarotPanel,
        )
      })

      // 输入框上方的小牌桌：聊天时顺手看一眼。
      ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'tarot',
            order: 30,
          },
          TarotDock,
        )
      })
    }

    function apply(ctx) {
      if (!React || !h) {
        console.error('[dsh-tarot] react is unavailable; plugin stays inert')
        return
      }
      try {
        start(ctx)
      } catch (error) {
        console.error('[dsh-tarot] apply failed', error)
      }
    }

    module.exports = {
      name: 'dsh-tarot',
      inject: ['slots', 'locale'],
      apply: apply,
    }
    return module.exports
  },
})
