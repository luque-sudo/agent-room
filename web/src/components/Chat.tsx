'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  getChannels, createChannel, getChannelMembers, getMessages,
  joinChannel, createWsConnection, listOnlineUsers, setMemberRole,
  type Channel, type Member, type Message, type ServerConfig,
} from '@/lib/api'
import { toggleTheme, getTheme, type Theme } from '@/lib/theme'
import { showToast } from '@/lib/toast'
import Sidebar from '@/components/Sidebar'
import MemberPanel from '@/components/MemberPanel'

interface Props {
  token: string
  userName: string
  entityId: string
  config: ServerConfig
  onLogout: () => void
}

/* ── Virtual message row type (includes system events + dividers) ── */
type RowKind = 'chat' | 'sysEvent' | 'historyDivider' | 'dm'

interface DisplayRow {
  id: string
  kind: RowKind
  message?: Message
  text?: string          // for sysEvent / historyDivider
  isMention?: boolean    // highlight gold border
  isDm?: boolean
}

/* ── Emoji list ──────────────────────────────────────────────────── */
const EMOJIS = ['😀','😂','😍','🤔','👍','👎','🔥','❤️','🎉','😎','🚀','💯','✅','❌','⚡','🙏','👀','💬','🤖','🧠','⬡','🏠','📋','🔑']

/* ── Command catalogue ───────────────────────────────────────────── */
const COMMANDS = [
  '/help', '/h',
  '/dm', '/mention', '/at',
  '/role', '/grant',
  '/myrole', '/whoami',
  '/permissions', '/perms',
  '/restrict',
  '/leave', '/l',
  '/join', '/j',
  '/create', '/c',
  '/members', '/m',
  '/rooms', '/r',
  '/switch', '/s',
  '/users', '/u',
  '/history', '/d',
  '/debug',
  '/quit', '/q',
]

const HELP_TEXT = `Commands
─────────────────────────────────────────
Room & Chat
  /join <room>         (/j)   Join a room
  /leave [room]        (/l)   Leave current or named channel
  /switch <room>       (/s)   Switch active channel
  /rooms               (/r)   List all channels
  /members [room]      (/m)   Show room members
  /users               (/u)   List online users
  /create <name>       (/c)   Create a new channel
  /history                    Show current room history

Messaging
  /dm <user> <msg>     (/d)   Send private message
  /dm [u1, u2] <msg>         Send to multiple users
  /dm u1,u2 <msg>            Comma-separated targets
  /mention <user>      (/at)  Mention a user (@user)
  /restrict <msg>             Send restricted message (admin/owner)
  Or just type: @username in any message

Permission Management
  /role <user> <role>         Set user role (owner/admin/member/guest)
  /grant <user> <role>        Grant role to user (alias for /role)
  /myrole              (/whoami) Show your role and permissions
  /permissions         (/perms)  Show room permission config

Other
  /debug                      Toggle signaling visibility
  /quit                (/q)   Exit / log out
  /help                (/h)   Show this help

Short aliases: /j /l /s /r /m /u /d /c /at /q /h
Permission shortcuts: /whoami = /myrole, /perms = /permissions
Press TAB to autocomplete commands.`

/* ── Command palette entries ─────────────────────────────────────── */
const GROUPED_COMMANDS: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: '🏠 Room & Chat',
    items: [
      ['/join <room>', 'Join a channel  (/j)'],
      ['/leave [room]', 'Leave channel  (/l)'],
      ['/switch <name>', 'Switch channel  (/s)'],
      ['/rooms', 'List all channels  (/r)'],
      ['/members [room]', 'Show members  (/m)'],
      ['/users', 'List online users  (/u)'],
      ['/create <name>', 'Create channel  (/c)'],
      ['/history', 'Reload history'],
    ],
  },
  {
    group: '💬 Messaging',
    items: [
      ['/dm <user> <msg>', 'Direct message  (/d)'],
      ['/dm [u1,u2] <msg>', 'Multi-user DM'],
      ['/dm u1,u2 <msg>', 'Comma DM syntax'],
      ['/mention <user> <msg>', 'Mention user  (/at)'],
      ['/restrict <msg>', 'Restricted message (admin)'],
    ],
  },
  {
    group: '🔐 Permission Management',
    items: [
      ['/role <user> <role>', 'Set member role (owner/admin/member/guest)'],
      ['/grant <user> <role>', 'Alias for /role'],
      ['/myrole', 'Your role + capabilities  (/whoami)'],
      ['/permissions', 'Room permission config  (/perms)'],
    ],
  },
  {
    group: '⚙️ Other',
    items: [
      ['/debug', 'Toggle WS debug mode'],
      ['/quit', 'Log out  (/q)'],
      ['/help', 'Show all commands  (/h)'],
    ],
  },
]

export default function Chat({ token, userName, entityId, config, onLogout }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [active, setActive] = useState<Channel | null>(null)
  const [rows, setRows] = useState<DisplayRow[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [draft, setDraft] = useState('')
  const [theme, setThemeState] = useState<Theme>('dark')
  const [showMembers, setShowMembers] = useState(true)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestIdx, setSuggestIdx] = useState(0)
  const [sysMsg, setSysMsg] = useState<string | null>(null)
  const [showCmdMenu, setShowCmdMenu] = useState(false)
  const [showChannelMenu, setShowChannelMenu] = useState(false)
  const [debugMode, setDebugMode] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)

  /* ── New state ───────────────────────────────────────────────── */
  const [isConnected, setIsConnected] = useState(false)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)

  const [connType, setConnTypeState] = useState<'ws' | 'sse' | 'simple'>('ws')

  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // keep a stable ref to active so ws.onmessage can read it without stale closure
  const activeRef = useRef<Channel | null>(null)
  activeRef.current = active
  // keep a stable ref to channels so ws.onopen can join all channels without stale closure
  const channelsRef = useRef<Channel[]>(channels)
  useEffect(() => { channelsRef.current = channels }, [channels])
  // track whether we have connected at least once (for reconnect toast)
  const hasConnectedOnce = useRef(false)
  // reconnect token — persisted in sessionStorage to survive page refresh
  const reconnectTokenRef = useRef<string | null>(
    typeof window !== 'undefined' ? sessionStorage.getItem('reconnectToken') : null
  )

  // reconnect tracking refs
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(1000)
  const isIntentionalCloseRef = useRef(false)
  const sysTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setThemeState(getTheme()) }, [])

  useEffect(() => {
    const stored = sessionStorage.getItem('connType')
    if (stored === 'sse') setConnTypeState('sse')
    else if (stored === 'simple') setConnTypeState('simple')
  }, [])

  /* ── Responsive: track window width ───────────────────────────── */
  useEffect(() => {
    function handleResize() {
      const mobile = window.innerWidth < 640
      setIsMobile(mobile)
      if (!mobile) setShowSidebar(true)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  /* ── Load channels ─────────────────────────────────────────────── */
  useEffect(() => {
    getChannels(config, token).then(list => {
      setChannels(list)
      if (list.length > 0 && !active) {
        const storedChannelId = sessionStorage.getItem('agentroom_activeChannel')
        const restored = storedChannelId ? list.find(c => c.id === storedChannelId) : null
        setActive(restored ?? list[0])
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, token])

  /* ── Load messages + members when channel changes ─────────────── */
  useEffect(() => {
    if (!active) return
    const channelId = active.id
    setIsLoadingMessages(true)
    getMessages(config, token, channelId).then(msgs => {
      if (activeRef.current?.id !== channelId) return  // discard stale response
      const divider: DisplayRow = {
        id: `divider-${channelId}-${Date.now()}`,
        kind: 'historyDivider',
        text: '── History ──',
      }
      const chatRows = messagesToRows(msgs, entityId, userName)
      setRows([divider, ...chatRows])
      setIsLoadingMessages(false)
    })
    getChannelMembers(config, token, channelId).then(members => {
      if (activeRef.current?.id !== channelId) return  // discard stale response
      setMembers(members)
    })
  }, [active, config, token, entityId, userName])

  /* ── When a new channel is added, subscribe to it on the WS ─── */
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    channels.forEach(ch => {
      ws.send(JSON.stringify({ type: 'action', payload: { action: 'join', channelId: ch.id } }))
    })
  }, [channels])

  /* ── Scroll to bottom ─────────────────────────────────────────── */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rows])

  /* ── WebSocket with auto-reconnect ───────────────────────────── */
  useEffect(() => {
    if (connType !== 'ws') return

    let ws: WebSocket | null = null

    function connect() {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      isIntentionalCloseRef.current = false
      ws = createWsConnection(config, token)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        reconnectDelayRef.current = 1000

        if (hasConnectedOnce.current) {
          showToast('Reconnected ✓', 'success', 2000)
        }
        hasConnectedOnce.current = true

        // Prefer reconnect flow — server will restore channels
        if (reconnectTokenRef.current) {
          ws!.send(JSON.stringify({ type: 'action', payload: { action: 'reconnect', reconnectToken: reconnectTokenRef.current } }))
          return
        }

        const ch = activeRef.current
        if (ch) {
          ws!.send(JSON.stringify({ type: 'action', payload: { action: 'join', channelId: ch.id } }))
        }
        // Subscribe to all other channels for unread message tracking
        const allChannels = channelsRef.current
        allChannels.forEach(c => {
          if (c.id !== ch?.id) {
            ws!.send(JSON.stringify({ type: 'action', payload: { action: 'join', channelId: c.id } }))
          }
        })
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as Record<string, unknown>
          const ch = activeRef.current

          /* Debug mode: show raw payload */
          if (debugMode) {
            const debugRow: DisplayRow = {
              id: `debug-${Date.now()}`,
              kind: 'sysEvent',
              text: `[debug] ${ev.data}`,
            }
            setRows(prev => [...prev, debugRow])
          }

          /* auth success — store reconnect token */
          if (msg.type === 'response') {
            const rp = msg.payload as { action?: string; success?: boolean; reconnectToken?: string; restoredChannels?: string[] } | undefined
            if (rp?.action === 'auth' && rp.success === true && rp.reconnectToken) {
              reconnectTokenRef.current = rp.reconnectToken
              sessionStorage.setItem('reconnectToken', rp.reconnectToken)
            }
            if (rp?.action === 'reconnect') {
              if (rp.success === true) {
                if (rp.reconnectToken) {
                  reconnectTokenRef.current = rp.reconnectToken
                  sessionStorage.setItem('reconnectToken', rp.reconnectToken)
                }
                // restore channels if the server sent them back
                if (Array.isArray(rp.restoredChannels) && rp.restoredChannels.length > 0) {
                  getChannels(config, token).then(list => {
                    const restored = list.filter(c => rp.restoredChannels!.includes(c.id))
                    if (restored.length > 0) setChannels(restored)
                  })
                }
              } else {
                // token expired/invalid — clear and fall back to normal auth on next reconnect
                reconnectTokenRef.current = null
                sessionStorage.removeItem('reconnectToken')
                // re-join all channels via normal flow
                const ws = wsRef.current
                if (ws && ws.readyState === WebSocket.OPEN) {
                  const allChannels = channelsRef.current
                  const ch = activeRef.current
                  allChannels.forEach(c => {
                    ws.send(JSON.stringify({ type: 'action', payload: { action: 'join', channelId: c.id } }))
                  })
                  void ch // ch is referenced for future channel join ordering; no-op here
                }
              }
            }
          }

          if (msg.type === 'chat') {
            const p = msg.payload as { content?: string; senderId?: string; senderName?: string; createdAt?: string; mentions?: string[]; isDm?: boolean } | undefined
            const content = p?.content ?? ''
            const isDm = p?.isDm === true || content.startsWith('/dm @')
            const hasMention = Array.isArray(p?.mentions) && p!.mentions.includes(userName)

            const newMsg: Message = {
              id: (msg.id as string | undefined) ?? String(Date.now()),
              content,
              senderId: p?.senderId ?? (msg.from as string | undefined) ?? '',
              senderName: p?.senderName,
              createdAt: p?.createdAt ?? (msg.ts as string | undefined) ?? new Date().toISOString(),
            }

            if (msg.channel === ch?.id) {
              const row: DisplayRow = {
                id: newMsg.id,
                kind: isDm ? 'dm' : 'chat',
                message: newMsg,
                isMention: hasMention,
                isDm,
              }
              setRows(prev => [...prev, row])

              if (hasMention) {
                showToast(`You were mentioned by ${p?.senderName ?? newMsg.senderId}`, 'mention')
              }
            } else if (typeof msg.channel === 'string') {
              /* Increment unread for non-active channel */
              setUnreadCounts(prev => ({ ...prev, [msg.channel as string]: (prev[msg.channel as string] ?? 0) + 1 }))
            }
          }

          /* member joined / left signal events */
          if (msg.type === 'signal') {
            const payload = msg.payload as { event?: string; entityId?: string; entityName?: string; channelId?: string } | undefined
            const event = payload?.event
            const name = payload?.entityName ?? 'Someone'
            const channelName = ch?.name ?? ''

            if (event === 'join') {
              const row: DisplayRow = {
                id: `sys-${Date.now()}`,
                kind: 'sysEvent',
                text: `→ ${name} joined #${channelName}`,
              }
              setRows(prev => [...prev, row])
              showToast(`→ ${name} joined #${channelName}`, 'info')
            } else if (event === 'leave') {
              const row: DisplayRow = {
                id: `sys-${Date.now()}`,
                kind: 'sysEvent',
                text: `← ${name} left #${channelName}`,
              }
              setRows(prev => [...prev, row])
              showToast(`← ${name} left`, 'info')
            }
          }

          /* @mention wake signal */
          if (msg.type === 'mention') {
            const p = msg.payload as { fromEntityName?: string; channelId?: string; context?: string } | undefined
            const from = p?.fromEntityName ?? 'Someone'
            showToast(`@mention from ${from}`, 'mention', 5000)
          }

          if (msg.type === 'response' && (msg.payload as { action?: string } | undefined)?.action === 'join') {
            getChannelMembers(config, token, ch?.id ?? '').then(setMembers)
          }
        } catch {}
      }

      ws.onclose = () => {
        setIsConnected(false)
        if (isIntentionalCloseRef.current) return

        const delay = reconnectDelayRef.current
        reconnectDelayRef.current = Math.min(delay * 2, 30000)

        if (hasConnectedOnce.current) {
          showToast(`Connection lost — retrying in ${Math.round(delay / 1000)}s…`, 'error')
        }

        reconnectTimeoutRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        setIsConnected(false)
      }
    }

    connect()

    return () => {
      isIntentionalCloseRef.current = true
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      ws?.close()
    }
  // debugMode and active intentionally excluded — WS only reconnects on token/config/connType change;
  // active channel is tracked via activeRef and managed by switchChannel()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, config, connType])

  /* ── SSE connection ───────────────────────────────────────────── */
  useEffect(() => {
    if (connType !== 'sse') return
    const sseUrl = sessionStorage.getItem('sseUrl') ?? ''
    if (!sseUrl || sseUrl === 'undefined') return

    const es = new EventSource(`${sseUrl}?token=${token}`)
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>
        if (msg.type === 'chat' && msg.channel === active?.id) {
          const p = msg.payload as { content?: string; senderId?: string; senderName?: string; createdAt?: string; mentions?: string[] } | undefined
          setRows(prev => [...prev, {
            id: (msg.id as string | undefined) ?? String(Date.now()),
            kind: 'chat',
            message: {
              id: (msg.id as string | undefined) ?? String(Date.now()),
              content: p?.content ?? '',
              senderId: p?.senderId ?? (msg.from as string | undefined) ?? '',
              senderName: p?.senderName,
              createdAt: p?.createdAt ?? (msg.ts as string | undefined) ?? new Date().toISOString(),
            },
            isMention: !!(p?.mentions?.includes?.(userName)),
          }])
        }
      } catch {}
    }
    es.onerror = () => {
      setIsConnected(false)
      showToast('SSE connection error', 'error')
    }
    es.onopen = () => setIsConnected(true)

    return () => es.close()
  }, [connType, token, config, active, userName])

  /* ── Simple service mode — no JWT, uses auth action handshake ─ */
  useEffect(() => {
    if (connType !== 'simple') return

    // Extract username from token format "simple:<name>"
    const simpleUsername = token.startsWith('simple:') ? token.slice(7) : token

    const ws = new WebSocket(config.wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Simple service auth — send name, no JWT
      ws.send(JSON.stringify({
        type: 'action',
        from: 'client',
        payload: { action: 'auth', name: simpleUsername },
      }))
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>

        // Welcome / auth response — join the active room
        if ((msg.type === 'system' || (msg.payload as { success?: boolean } | undefined)?.success) && activeRef.current) {
          const roomName = activeRef.current.name
          ws.send(JSON.stringify({
            type: 'action',
            from: simpleUsername,
            payload: { action: 'room.join', room_id: roomName },
          }))
          setIsConnected(true)
        }

        // Chat message from simple service protocol
        if (msg.type === 'chat') {
          const p = msg.payload as { message?: string; content?: string } | undefined
          const content = p?.message ?? p?.content ?? ''
          const sender = (msg.from as string | undefined) ?? ''
          setRows(prev => [...prev, {
            id: (msg.id as string | undefined) ?? String(Date.now()),
            kind: 'chat' as const,
            message: {
              id: (msg.id as string | undefined) ?? String(Date.now()),
              content,
              senderId: sender,
              senderName: sender,
              createdAt: (msg.timestamp as string | undefined) ?? (msg.ts as string | undefined) ?? new Date().toISOString(),
            },
            isMention: content.includes(`@${simpleUsername}`),
          }])
        }

        // System events (user joined/left)
        if (msg.type === 'system') {
          const payload = msg.payload as { event?: string; name?: string } | undefined
          if (payload?.event === 'user.joined' || payload?.event === 'user.left') {
            const name = payload?.name ?? (msg.from as string | undefined) ?? 'someone'
            const verb = payload?.event === 'user.joined' ? 'joined' : 'left'
            setRows(prev => [...prev, {
              id: String(Date.now()),
              kind: 'sysEvent' as const,
              text: `${verb === 'joined' ? '→' : '←'} ${name} ${verb}`,
            }])
          }
        }
      } catch {}
    }

    ws.onclose = () => setIsConnected(false)
    ws.onerror = () => { setIsConnected(false); showToast('Simple service connection error', 'error') }

    return () => ws.close()
  }, [connType, token, config, active])

  /* ── Tab / autocomplete suggestions ──────────────────────────── */
  function updateSuggestions(val: string) {
    if (val.startsWith('/')) {
      const matches = COMMANDS.filter(c => c.startsWith(val))
      setSuggestions(matches)
      setSuggestIdx(0)
    } else if (val.includes('@')) {
      const atPart = val.split('@').pop() ?? ''
      const matches = members
        .map(m => m.entityName ?? m.entityId)
        .filter(n => n.toLowerCase().startsWith(atPart.toLowerCase()))
        .map(n => `@${n}`)
      setSuggestions(matches)
      setSuggestIdx(0)
    } else {
      setSuggestions([])
    }
  }

  function applySuggestion(sg: string) {
    if (sg.startsWith('/')) {
      setDraft(sg + ' ')
    } else {
      const parts = draft.split('@')
      parts[parts.length - 1] = sg.slice(1) + ' '
      setDraft(parts.join('@'))
    }
    setSuggestions([])
    inputRef.current?.focus()
  }

  /* ── System message banner ─────────────────────────────────────── */
  const addSysMessage = useCallback((text: string) => {
    if (sysTimeoutRef.current) clearTimeout(sysTimeoutRef.current)
    setSysMsg(text)
    sysTimeoutRef.current = setTimeout(() => setSysMsg(null), 6000)
  }, [])

  useEffect(() => () => { if (sysTimeoutRef.current) clearTimeout(sysTimeoutRef.current) }, [])

  /* ── History helper ─────────────────────────────────────────────── */
  async function reloadHistory() {
    if (!active) return
    setIsLoadingMessages(true)
    const msgs = await getMessages(config, token, active.id)
    const divider: DisplayRow = {
      id: `divider-reload-${Date.now()}`,
      kind: 'historyDivider',
      text: '── History ──',
    }
    const chatRows = messagesToRows(msgs, entityId, userName)
    setRows([divider, ...chatRows])
    setIsLoadingMessages(false)
    addSysMessage(`Loaded ${msgs.length} messages for #${active.name}`)
  }

  /* ── Slash command handler ─────────────────────────────────────── */
  async function handleCommand(cmd: string) {
    const trimmed = cmd.trim()
    const parts = trimmed.split(' ')
    const command = parts[0]
    const args = parts.slice(1)

    try {
      switch (command) {
        /* ── help ── */
        case '/h':
        case '/help':
          addSysMessage(HELP_TEXT)
          break

        /* ── members ── */
        case '/members':
        case '/m': {
          if (args[0]) {
            const query = args.join(' ').toLowerCase()
            const targetCh = channels.find(c =>
              c.id === args[0] ||
              c.name.toLowerCase() === query ||
              c.name.toLowerCase() === args[0].toLowerCase()
            )
            if (targetCh) {
              const m = await getChannelMembers(config, token, targetCh.id)
              addSysMessage(`Members of #${targetCh.name}: ${m.map(x => x.entityName ?? x.entityId).join(', ') || '(none)'}`)
            } else {
              addSysMessage(`No channel matching "${args[0]}". Use /rooms to list channels.`)
            }
          } else if (active) {
            const m = await getChannelMembers(config, token, active.id)
            setMembers(m)
            addSysMessage(`Members: ${m.map(x => x.entityName ?? x.entityId).join(', ')}`)
          }
          break
        }

        /* ── create ── */
        case '/create':
        case '/c':
          if (args[0]) await handleCreateChannel(args[0])
          else addSysMessage('Usage: /create <name>')
          break

        /* ── join ── */
        case '/join':
        case '/j': {
          if (!args[0]) { addSysMessage('Usage: /join <channelId>'); break }
          try {
            await joinChannel(config, token, args[0], entityId)
            const list = await getChannels(config, token)
            setChannels(list)
            const ch = list.find(c => c.id === args[0])
            if (ch) {
              switchChannel(ch)
              addSysMessage(`Joined #${ch.name}`)
            } else {
              addSysMessage(`Joined channel. Use /rooms to see updated list.`)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to join channel'
            addSysMessage(`Error: ${msg}`)
            showToast(msg, 'error')
          }
          break
        }

        /* ── leave ── */
        case '/leave':
        case '/l': {
          if (!wsRef.current) break
          if (args[0]) {
            const query = args.join(' ').toLowerCase()
            const targetCh = channels.find(c =>
              c.id === args[0] ||
              c.name.toLowerCase() === query ||
              c.name.toLowerCase() === args[0].toLowerCase()
            )
            if (targetCh) {
              wsRef.current.send(JSON.stringify({ type: 'action', payload: { action: 'leave', channelId: targetCh.id } }))
              setChannels(prev => prev.filter(c => c.id !== targetCh.id))
              if (active?.id === targetCh.id) setActive(channels.find(c => c.id !== targetCh.id) ?? null)
              addSysMessage(`Left #${targetCh.name}`)
            } else {
              addSysMessage(`No channel matching "${args[0]}". Use /rooms to list channels.`)
            }
          } else if (active) {
            wsRef.current.send(JSON.stringify({ type: 'action', payload: { action: 'leave', channelId: active.id } }))
            const remaining = channels.filter(c => c.id !== active.id)
            setChannels(remaining)
            setActive(remaining[0] ?? null)
            addSysMessage(`Left #${active.name}`)
          }
          break
        }

        /* ── myrole / whoami ── */
        case '/whoami':
        case '/myrole': {
          const me = members.find(m => m.entityId === entityId)
          if (!me) { addSysMessage('You are not a member of this channel'); break }
          const role = me.role.toLowerCase()
          const isOwner = role === 'owner'
          const isAdmin = isOwner || role === 'admin'
          const isMember = isAdmin || role === 'member'
          const tick = (v: boolean) => v ? '✓' : '✗'
          const channelName = active?.name ?? '?'
          const capTable = [
            `Your Permissions in #${channelName}`,
            `  Role: ${me.role}`,
            `  Capabilities:`,
            `    Messaging:`,
            `      ${tick(isMember)} send message`,
            `      ${tick(isAdmin)} send restricted message   (only owner/admin)`,
            `    Moderation:`,
            `      ${tick(isAdmin)} delete message          (owner/admin only)`,
            `      ${tick(isAdmin)} edit message            (owner/admin only)`,
            `      ${tick(isAdmin)} pin message             (owner/admin only)`,
            `    Management:`,
            `      ${tick(isAdmin)} invite member           (owner/admin)`,
            `      ${tick(isAdmin)} kick member             (owner/admin)`,
            `      ${tick(isOwner)} modify permissions      (owner only)`,
            `    Access:`,
            `      ✓ view history`,
            `      ✓ view members`,
            `      ✓ send dm`,
          ].join('\n')
          addSysMessage(capTable)
          break
        }

        /* ── permissions / perms ── */
        case '/perms':
        case '/permissions': {
          const channelName = active?.name ?? '?'
          const channelType = active?.type ?? 'CHANNEL'
          const isPublic = active?.isPublic ?? true
          const permInfo = [
            `Room Configuration #${channelName}`,
            `  Type: ${channelType}`,
            `  Public: ${isPublic ? 'yes' : 'no'}`,
            `  Who Can:`,
            `    Send messages: owner, admin, member`,
            `    Delete messages: owner, admin`,
            `    Invite members: owner, admin`,
            `    Kick members: owner, admin`,
            `    Modify permissions: owner`,
          ].join('\n')
          addSysMessage(permInfo)
          break
        }

        /* ── restrict ── */
        case '/restrict': {
          if (!active || !wsRef.current) break
          const text = args.join(' ')
          if (!text) { addSysMessage('Usage: /restrict <message>'); break }
          wsRef.current.send(JSON.stringify({
            type: 'chat',
            channel: active.id,
            payload: { content: text, restricted: true },
          }))
          break
        }

        /* ── dm ── */
        case '/dm':
        case '/d': {
          if (!active || !wsRef.current) break
          const rest = args.join(' ')
          const bracketMatch = rest.match(/^\[([^\]]+)\]\s+(.+)/)
          if (bracketMatch) {
            const targets = bracketMatch[1].split(',').map(t => t.trim()).filter(Boolean)
            const text = bracketMatch[2]
            wsRef.current.send(JSON.stringify({
              type: 'chat',
              channel: active.id,
              payload: { content: `/dm [${targets.join(', ')}]: ${text}`, mentions: targets, isDm: true },
            }))
          } else if (args.length >= 2 && args[0].includes(',') && !args[0].includes('[')) {
            const targets = args[0].split(',').map(t => t.trim().replace(/^@/, '')).filter(Boolean)
            const text = args.slice(1).join(' ')
            wsRef.current.send(JSON.stringify({
              type: 'chat',
              channel: active.id,
              payload: { content: `/dm [${targets.join(', ')}]: ${text}`, mentions: targets, isDm: true },
            }))
          } else if (args.length >= 2) {
            const target = args[0].replace(/^@/, '')
            const text = args.slice(1).join(' ')
            wsRef.current.send(JSON.stringify({
              type: 'chat',
              channel: active.id,
              payload: { content: `/dm @${target}: ${text}`, mentions: [target], isDm: true },
            }))
          } else {
            addSysMessage('Usage: /dm <username> <message>  or  /dm [user1, user2] <message>  or  /dm user1,user2 <message>')
          }
          break
        }

        /* ── mention / at ── */
        case '/at':
        case '/mention': {
          if (!active || !wsRef.current) break
          if (args.length >= 2) {
            const target = args[0].replace(/^@/, '')
            const text = args.slice(1).join(' ')
            wsRef.current.send(JSON.stringify({
              type: 'chat',
              channel: active.id,
              payload: { content: `@${target} ${text}`, mentions: [target] },
            }))
          } else {
            addSysMessage('Usage: /mention <username> <message>')
          }
          break
        }

        /* ── role / grant ── */
        case '/role':
        case '/grant':
          if (active && args.length >= 2) {
            const targetName = args[0]
            const role = args[1]
            const targetMember = members.find(m => (m.entityName ?? m.entityId) === targetName)
            if (targetMember) {
              try {
                await setMemberRole(config, token, active.id, targetMember.entityId, role)
                addSysMessage(`Set ${targetName}'s role to ${role}`)
                const updated = await getChannelMembers(config, token, active.id)
                setMembers(updated)
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to set role'
                addSysMessage(`Error: ${msg}`)
                showToast(msg, 'error')
              }
            } else {
              addSysMessage(`User "${targetName}" not found in this channel.`)
            }
          } else {
            addSysMessage('Usage: /role <username> <role>  or  /grant <username> <role>')
          }
          break

        /* ── rooms ── */
        case '/rooms':
        case '/r': {
          const list = await getChannels(config, token)
          setChannels(list)
          const names = list.map(c => `  # ${c.name}  (${c.id})`).join('\n')
          addSysMessage(`Channels:\n${names || '(none)'}`)
          break
        }

        /* ── switch ── */
        case '/switch':
        case '/s': {
          if (!args[0]) { addSysMessage('Usage: /switch <name-or-id>'); break }
          const query = args.join(' ').toLowerCase()
          const found = channels.find(c =>
            c.id === query ||
            c.name.toLowerCase() === query ||
            c.name.toLowerCase().includes(query)
          )
          if (found) {
            switchChannel(found)
            addSysMessage(`Switched to #${found.name}`)
          } else {
            addSysMessage(`No channel matching "${query}". Use /rooms to list channels.`)
          }
          break
        }

        /* ── users ── */
        case '/users':
        case '/u': {
          const users = await listOnlineUsers(config, token)
          const names = users.map(u => `  • ${u.name}  (${u.id})`).join('\n')
          addSysMessage(`Online users:\n${names || '(none)'}`)
          break
        }

        /* ── history ── */
        case '/history':
          await reloadHistory()
          break

        /* ── debug ── */
        case '/debug':
          setDebugMode(prev => {
            const next = !prev
            addSysMessage(`Debug mode: ${next ? 'ON' : 'OFF'}`)
            return next
          })
          break

        /* ── quit ── */
        case '/quit':
        case '/q':
          sessionStorage.removeItem('agentroom_activeChannel')
          sessionStorage.removeItem('reconnectToken')
          reconnectTokenRef.current = null
          isIntentionalCloseRef.current = true
          wsRef.current?.close()
          onLogout()
          break

        default:
          addSysMessage(`Unknown command: ${command}. Type /help for available commands.`)
      }
    } catch (err) {
      const errMessage = `Error: ${err instanceof Error ? err.message : String(err)}`
      addSysMessage(errMessage)
      showToast(errMessage, 'error')
    }
  }

  /* ── Send message ──────────────────────────────────────────────── */
  const send = useCallback(() => {
    const text = draft.trim()
    if (!text || !wsRef.current || !active) return
    if (text.startsWith('/')) {
      handleCommand(text)
      setDraft('')
      return
    }
    const mentions = (text.match(/@(\w+)/g) ?? []).map(m => m.slice(1))
    if (connType === 'simple') {
      const simpleUsername = token.startsWith('simple:') ? token.slice(7) : token
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        from: simpleUsername,
        to: `room:${active.name}`,
        payload: { message: text },
      }))
    } else {
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        channel: active.id,
        payload: { content: text, ...(mentions.length ? { mentions } : {}) },
      }))
    }
    setDraft('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, active, members, connType, token])

  /* ── Create channel ────────────────────────────────────────────── */
  async function handleCreateChannel(name: string, opts?: { persistent?: boolean }) {
    try {
      const ch = await createChannel(config, token, name, opts)
      setChannels(prev => [...prev, ch])
      switchChannel(ch)
      showToast(`Created #${name}`, 'success')
    } catch (err) {
      const errMessage = `Error: ${err instanceof Error ? err.message : String(err)}`
      addSysMessage(errMessage)
      showToast(errMessage, 'error')
    }
  }

  /* ── Switch channel (rejoin WS) ───────────────────────────────── */
  function switchChannel(ch: Channel) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'action', payload: { action: 'join', channelId: ch.id } }))
    }
    sessionStorage.setItem('agentroom_activeChannel', ch.id)
    setActive(ch)
    setRows([])
    setMembers([])
    setUnreadCounts(prev => { const next = { ...prev }; delete next[ch.id]; return next })
    if (isMobile) setShowSidebar(false)
  }

  /* ── Prompt switch sub-input via sysMsg ───────────────────────── */
  function promptSwitch() {
    addSysMessage('Type /switch <channel-name> or /s <name> to switch channels.')
    setShowChannelMenu(false)
    setTimeout(() => { inputRef.current?.focus() }, 50)
  }

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div style={s.shell}>
      {/* Mobile overlay backdrop */}
      {isMobile && showSidebar && (
        <div
          style={s.mobileBackdrop}
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      {(!isMobile || showSidebar) && (
        <div style={isMobile ? s.sidebarMobileWrapper : undefined}>
          <Sidebar
            userName={userName}
            channels={channels}
            activeChannelId={active?.id ?? null}
            unreadCounts={unreadCounts}
            isConnected={isConnected}
            isMobile={isMobile}
            showSidebar={showSidebar}
            theme={theme}
            onToggleTheme={() => setThemeState(toggleTheme())}
            onLogout={() => {
              sessionStorage.removeItem('agentroom_activeChannel')
              sessionStorage.removeItem('reconnectToken')
              reconnectTokenRef.current = null
              isIntentionalCloseRef.current = true
              wsRef.current?.close()
              onLogout()
            }}
            onSelectChannel={switchChannel}
            onCreateChannel={(name, opts) => handleCreateChannel(name, opts)}
            onCloseSidebar={() => setShowSidebar(false)}
          />
        </div>
      )}

      {/* ── Main ────────────────────────────────────────────────── */}
      <main style={s.main}>
        <header style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {isMobile && (
              <button style={s.headerBtn} onClick={() => setShowSidebar(v => !v)} title="Toggle sidebar">☰</button>
            )}
            <span style={s.headerTitle}>{active ? `# ${active.name}` : 'Select a channel'}</span>
            {/* Connection status dot */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isConnected ? 'var(--success)' : 'var(--danger)',
                display: 'inline-block',
                flexShrink: 0,
                ...(isConnected ? {} : { animation: 'pulse 1.5s ease infinite' }),
              }}
              title={isConnected ? 'Connected' : 'Disconnected'}
            />
            {active?.description && <span style={s.headerDesc}>{active.description}</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {!isMobile && (
              <button style={s.headerBtn} onClick={() => setShowMembers(v => !v)} title="Toggle member list">
                👥 {members.length}
              </button>
            )}
            {active && (
              <div style={{ position: 'relative' }}>
                <button style={s.headerBtn} onClick={() => setShowChannelMenu(v => !v)}>⋯</button>
                {showChannelMenu && (
                  <div style={s.dropMenu} onClick={() => setShowChannelMenu(false)}>
                    <button style={s.dropItem} onClick={() => { navigator.clipboard.writeText(active.id); addSysMessage(`Channel ID copied: ${active.id}`) }}>Copy channel ID</button>
                    <button style={s.dropItem} onClick={() => handleCommand('/members')}>List members</button>
                    <button style={s.dropItem} onClick={() => handleCommand('/users')}>List online users</button>
                    <button style={s.dropItem} onClick={() => handleCommand('/history')}>View history</button>
                    <button style={s.dropItem} onClick={promptSwitch}>Switch to...</button>
                    <button style={s.dropItem} onClick={() => handleCommand('/myrole')}>My role</button>
                    <button style={s.dropItem} onClick={() => handleCommand('/permissions')}>Permissions</button>
                    <div style={s.dropDivider} />
                    <button style={{ ...s.dropItem, color: 'var(--danger)' }} onClick={() => handleCommand('/leave')}>Leave channel</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* System message banner */}
        {sysMsg && (
          <div style={s.sysBanner}>
            <pre style={s.sysPre}>{sysMsg}</pre>
            <button onClick={() => setSysMsg(null)} style={s.sysClose}>✕</button>
          </div>
        )}

        <div style={s.messages}>
          {isLoadingMessages ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0.5rem 0', opacity: 1 - i * 0.15 }}>
                <div className="skeleton" style={{ height: 10, width: `${60 + i * 8}%` }} />
                <div className="skeleton" style={{ height: 14, width: `${40 + i * 5}%` }} />
              </div>
            ))
          ) : (
            <>
              {rows.map(row => {
                if (row.kind === 'historyDivider') {
                  return (
                    <div key={row.id} style={s.historyDivider}>{row.text}</div>
                  )
                }
                if (row.kind === 'sysEvent') {
                  return (
                    <div key={row.id} style={s.sysEventRow}>{row.text}</div>
                  )
                }
                if (!row.message) return null
                const m = row.message
                const isMe = m.senderId === entityId
                const isDm = row.isDm
                const isMention = row.isMention

                let rowStyle: React.CSSProperties = { ...s.msg, ...(isMe ? s.msgMe : {}), position: 'relative' }
                if (isDm) rowStyle = { ...rowStyle, ...s.msgDm }
                if (isMention) rowStyle = { ...rowStyle, ...s.msgMention }

                return (
                  <div
                    key={row.id}
                    className="animate-fadeSlideUp"
                    style={rowStyle}
                    onMouseEnter={() => setHoveredRowId(row.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                  >
                    {/* Hover action bar */}
                    {hoveredRowId === row.id && row.kind === 'chat' && (
                      <div style={{ position: 'absolute', top: -14, right: 4, display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '1px 4px', boxShadow: '0 2px 8px #0003', zIndex: 10 }}>
                        <button
                          title="Copy"
                          style={s.msgAction}
                          onClick={() => { navigator.clipboard.writeText(row.message?.content ?? ''); showToast('Copied!', 'success', 1500) }}
                        >
                          📋
                        </button>
                        <button
                          title="Reply"
                          style={s.msgAction}
                          onClick={() => { setDraft(`@${row.message?.senderName ?? ''} `); inputRef.current?.focus() }}
                        >
                          ↩
                        </button>
                        <button
                          title="DM"
                          style={s.msgAction}
                          onClick={() => { setDraft(`/dm ${row.message?.senderName ?? ''} `); inputRef.current?.focus() }}
                        >
                          💬
                        </button>
                      </div>
                    )}
                    <div style={s.msgMeta}>
                      {isDm && <span style={s.dmTag}>[DM]</span>}
                      <span style={{ ...s.msgSender, ...(isMe ? { color: 'var(--success)' } : {}) }}>
                        {m.senderName ?? m.senderId.slice(0, 8)}
                      </span>
                      <span style={s.msgTime}>{new Date(m.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p style={s.msgContent} dangerouslySetInnerHTML={{ __html: renderContent(m.content) }} />
                  </div>
                )
              })}
              {rows.length === 0 && active && <p style={s.emptyMsg}>No messages yet — say hi!</p>}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Autocomplete suggestions */}
        {suggestions.length > 0 && (
          <div style={s.suggestions}>
            {suggestions.map((sg, i) => (
              <button
                key={sg}
                style={{ ...s.suggestion, ...(i === suggestIdx ? s.suggestionActive : {}) }}
                onClick={() => applySuggestion(sg)}
              >
                {sg}
              </button>
            ))}
          </div>
        )}

        {connType === 'sse' && (
          <div style={{ padding: '0.5rem 1.2rem', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            SSE mode — read-only stream. Sending messages is disabled.
          </div>
        )}

        <form style={s.inputRow} onSubmit={e => { e.preventDefault(); send() }}>
          {/* Commands palette button */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button type="button" style={s.cmdBtn} onClick={() => setShowCmdMenu(v => !v)} title="Commands">/</button>
            {showCmdMenu && (
              <div style={{ ...s.dropMenu, bottom: '110%', top: 'auto', left: 0, right: 'auto', width: 280 }} onClick={() => setShowCmdMenu(false)}>
                {GROUPED_COMMANDS.map(({ group, items }) => (
                  <div key={group}>
                    <div style={s.cmdGroup}>{group}</div>
                    {items.map(([cmd, desc]) => (
                      <button
                        key={cmd}
                        style={s.dropItem}
                        onClick={() => {
                          setDraft(cmd.split(' ')[0] + ' ')
                          setSuggestions([])
                          setShowCmdMenu(false)
                          inputRef.current?.focus()
                        }}
                      >
                        <span style={{ color: 'var(--accent)', fontFamily: 'monospace', fontSize: '0.82rem' }}>{cmd}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: '0.4rem' }}>{desc}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Emoji picker button */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              style={s.cmdBtn}
              onClick={() => setShowEmoji(v => !v)}
              title="Emoji"
            >
              😊
            </button>
            {showEmoji && (
              <div style={{ ...s.emojiPicker, bottom: '110%', top: 'auto', left: 0 }} onClick={() => setShowEmoji(false)}>
                <div style={s.emojiGrid}>
                  {EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      style={s.emojiBtn}
                      onClick={() => {
                        setDraft(prev => prev + emoji)
                        inputRef.current?.focus()
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <input
            ref={inputRef}
            style={s.msgInput}
            placeholder={active ? `Message #${active.name} — type /help for commands` : 'Select a channel'}
            value={draft}
            onChange={e => { setDraft(e.target.value); updateSuggestions(e.target.value) }}
            onKeyDown={e => {
              if (suggestions.length > 0) {
                if (e.key === 'Tab' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSuggestIdx(i => (i + 1) % suggestions.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSuggestIdx(i => (i - 1 + suggestions.length) % suggestions.length)
                } else if (e.key === 'Enter' && suggestions.length > 0) {
                  e.preventDefault()
                  applySuggestion(suggestions[suggestIdx])
                } else if (e.key === 'Escape') {
                  setSuggestions([])
                }
              }
            }}
            disabled={!active || connType === 'sse'}
          />
          <button type="submit" style={s.sendBtn} disabled={!active || !draft.trim() || connType === 'sse'}>Send</button>
        </form>
      </main>

      {/* ── Member panel ────────────────────────────────────────── */}
      {showMembers && !isMobile && (
        <MemberPanel
          channel={active}
          members={members}
          currentUserEntityId={entityId}
          onDmUser={(name) => { setDraft(`/dm ${name} `); inputRef.current?.focus() }}
          onSetRole={(eid, name) => { setDraft(`/role ${name} `); inputRef.current?.focus() }}
        />
      )}
    </div>
  )
}

/* ── Helper: convert Message[] → DisplayRow[] ──────────────────── */
function messagesToRows(msgs: Message[], entityId: string, userName: string): DisplayRow[] {
  return msgs.map(m => {
    const isDm = m.content.startsWith('/dm @') || m.content.startsWith('/dm [')
    const isMention = m.content.includes(`@${userName}`)
    return {
      id: m.id,
      kind: (isDm ? 'dm' : 'chat') as RowKind,
      message: m,
      isDm,
      isMention,
    }
  })
}

/* ── renderContent: escape HTML then highlight @mentions ─────── */
function renderContent(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/@(\w+)/g, '<strong style="color:var(--accent)">@$1</strong>')
}

/* ── Styles ──────────────────────────────────────────────────────── */
const s: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', height: '100dvh', overflow: 'hidden', background: 'var(--bg)', position: 'relative' },

  /* mobile overlay */
  mobileBackdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 190 },

  /* mobile sidebar wrapper */
  sidebarMobileWrapper: { position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 200, display: 'flex' },

  /* main */
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1.2rem', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 },
  headerTitle: { fontWeight: 600, fontSize: '0.95rem' },
  headerDesc: { color: 'var(--text-muted)', fontSize: '0.8rem' },
  headerBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '0.25rem 0.6rem', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer' },
  sysBanner: { background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', padding: '0.65rem 1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexShrink: 0 },
  sysPre: { fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', flex: 1 },
  sysClose: { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },

  /* message rows */
  msg: { padding: '0.5rem 0.75rem', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: '80%' },
  msgMe: { alignSelf: 'flex-end', background: 'var(--accent-dim)', borderColor: 'var(--accent)' },
  msgDm: { borderLeft: '3px solid #805ad5', background: 'rgba(128,90,213,0.07)' },
  msgMention: { borderLeft: '3px solid #d69e2e', background: 'rgba(214,158,46,0.08)' },
  msgMeta: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.2rem' },
  msgSender: { fontWeight: 600, fontSize: '0.82rem', color: 'var(--accent)' },
  msgTime: { fontSize: '0.7rem', color: 'var(--text-muted)' },
  msgContent: { fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word', margin: 0 },
  dmTag: { fontSize: '0.7rem', fontWeight: 700, color: '#805ad5', background: 'rgba(128,90,213,0.15)', borderRadius: 3, padding: '0.05rem 0.3rem', marginRight: '0.2rem' },
  msgAction: { background: 'none', border: 'none', cursor: 'pointer', padding: '0 3px', fontSize: '0.8rem', color: 'var(--text-muted)' },

  /* system event row (join/leave/debug) */
  sysEventRow: { fontStyle: 'italic', fontSize: '0.8rem', color: 'var(--text-muted)', paddingLeft: '0.4rem', alignSelf: 'center', opacity: 0.8 },

  /* history divider */
  historyDivider: { textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.4rem 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem', letterSpacing: '0.06em' },

  emptyMsg: { color: 'var(--text-muted)', textAlign: 'center', marginTop: '3rem', fontSize: '0.9rem' },
  suggestions: { display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.4rem 1.2rem', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 },
  suggestion: { padding: '0.2rem 0.5rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer' },
  suggestionActive: { background: 'var(--accent-dim)', borderColor: 'var(--accent)', color: 'var(--accent)' },
  inputRow: { display: 'flex', gap: '0.5rem', padding: '0.85rem 1.2rem', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 },
  msgInput: { flex: 1, padding: '0.6rem 0.9rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', fontSize: '0.9rem' },
  sendBtn: { padding: '0.6rem 1.1rem', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer' },
  cmdBtn: { padding: '0.6rem 0.75rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--accent)', fontWeight: 700, fontFamily: 'monospace', fontSize: '1rem', cursor: 'pointer' },
  dropMenu: { position: 'absolute', top: '110%', right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px #0004', zIndex: 100, minWidth: 170, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  dropItem: { display: 'flex', alignItems: 'baseline', width: '100%', textAlign: 'left', padding: '0.5rem 0.85rem', background: 'none', border: 'none', color: 'var(--text)', fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', gap: '0.25rem' },
  dropDivider: { height: 1, background: 'var(--border)', margin: '0.25rem 0' },
  cmdGroup: { padding: '0.35rem 0.85rem 0.15rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', color: 'var(--text-muted)', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' },

  /* emoji picker */
  emojiPicker: { position: 'absolute', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px #0004', zIndex: 100, padding: '0.5rem' },
  emojiGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.15rem' },
  emojiBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0.25rem', borderRadius: 6, lineHeight: 1 },
}
