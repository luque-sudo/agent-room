#!/usr/bin/env node
import WebSocket from "ws";
import * as readline from "readline";

// ─── CLI Args ────────────────────────────────────────────────────────

function parseArgs(): { url: string; name: string; room: string; jwt?: string; daemon: boolean } {
  const args = process.argv.slice(2);
  let url = "";
  let name = process.env.USER ?? process.env.USERNAME ?? "user";
  let room = "general";
  let jwt: string | undefined;
  let daemon = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--url" && next) {
      url = next;
      i++;
    } else if (arg === "--name" && next) {
      name = next;
      i++;
    } else if (arg === "--room" && next) {
      room = next;
      i++;
    } else if (arg === "--jwt" && next) {
      jwt = next;
      i++;
    } else if (arg === "--daemon" || arg === "-d") {
      daemon = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: agent-room-cli [options]

Options:
  --url <url>      WebSocket service URL (default: ws://localhost:9000)
  --name <name>    Your display name (default: $USER)
  --room <room>    Room to join (default: general)
  --jwt <token>    JWT access token (connects to full-stack WS on :3001)
  --daemon, -d     Listen-only mode: display incoming messages, no interactive input
  --help, -h       Show this help message

  To get a JWT token: POST /auth/login with your credentials.

Examples:
  agent-room-cli
  agent-room-cli --name Alice --room general
  agent-room-cli --url ws://server:9000 --name Bob --room dev-ops
  agent-room-cli --jwt <token> --room general   (full-stack WS mode)

When using npm run:
  npm run service:cli -- --name Alice --room general
  npm run service:cli -- --jwt <token> --room general
  (Note the "--" separator after service:cli)
`);
      process.exit(0);
    } else if (!arg.startsWith("--") && i === 0) {
      name = arg;
      if (args[i + 1]) url = args[i + 1];
      if (args[i + 2]) room = args[i + 2];
      break;
    }
  }

  if (!url) {
    url = jwt ? "ws://localhost:3001" : "ws://localhost:9000";
  }

  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    url = "ws://" + url;
  }

  return { url, name, room, jwt, daemon };
}

const { url: URL, name: NAME, room: ROOM, jwt: JWT, daemon: DAEMON } = parseArgs();

// ─── Colors ──────────────────────────────────────────────────────────

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const WHITE = "\x1b[37m";

// ─── State ───────────────────────────────────────────────────────────

let connected = false;
let authenticated = false;
let activeRoom = ROOM;
const joinedRooms = new Set<string>();
let showDebug = false;
let promptActive = false;
let userId = "";
let rlClosed = false;

// ─── UI ──────────────────────────────────────────────────────────────

function clearLine() {
  process.stdout.write("\r\x1b[K");
}

function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function getRoleColor(role: string | undefined): string {
  switch (role?.toLowerCase()) {
    case "owner": return RED;
    case "admin": return YELLOW;
    case "moderator": return BLUE;
    case "member": return GREEN;
    case "guest": return DIM;
    default: return "";
  }
}

// ─── Mention Parsing ─────────────────────────────────────────────────

function extractMentions(message: string): string[] {
  const mentions: string[] = [];
  const mentionRegex = /@([\w\-]+|"[^"]+"|'[^']+')/g;
  let match;
  while ((match = mentionRegex.exec(message)) !== null) {
    let mentioned = match[1];
    if (
      (mentioned.startsWith('"') && mentioned.endsWith('"')) ||
      (mentioned.startsWith("'") && mentioned.endsWith("'"))
    ) {
      mentioned = mentioned.slice(1, -1);
    }
    if (mentioned && !mentions.includes(mentioned)) {
      mentions.push(mentioned);
    }
  }
  return mentions;
}

function highlightMentions(message: string, currentUser: string): string {
  const mentionRegex = /@([\w\-]+|"[^"]+"|'[^']+')/g;
  return message.replace(mentionRegex, (_match, username: string) => {
    let clean = username;
    if (
      (clean.startsWith('"') && clean.endsWith('"')) ||
      (clean.startsWith("'") && clean.endsWith("'"))
    ) {
      clean = clean.slice(1, -1);
    }
    if (clean === currentUser) {
      return `${YELLOW}${BOLD}@${clean}${R}`;
    }
    return `${CYAN}@${clean}${R}`;
  });
}

function printMsg(line: string) {
  if (promptActive) {
    clearLine();
  }
  console.log(line);
  if (!promptActive) {
    schedulePrompt();
  } else {
    process.stdout.write(promptPrefix());
  }
}

function promptPrefix() {
  return `${DIM}${timestamp()}${R} ${GREEN}#${activeRoom}${R} ${BOLD}>${R} `;
}

let promptTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePrompt() {
  if (promptTimer) return;
  promptTimer = setTimeout(() => {
    promptTimer = null;
    showPrompt();
  }, 50);
}

function showPrompt() {
  if (DAEMON || !rl) return;
  // Bug fix: guard against calling rl.question on a closed interface
  if (connected && authenticated && !promptActive && !rlClosed) {
    promptActive = true;
    rl.question(promptPrefix(), handleInput);
  }
}

// ─── Connect ─────────────────────────────────────────────────────────

console.log();
console.log(`${BOLD} AgentRoom Chat ${R}`);
console.log(`${DIM} Connecting to ${URL} as "${NAME}"...${R}`);
console.log(`${DIM} Mode: ${JWT ? "Full-stack WS (JWT)" : "Simple service"}${R}`);
console.log();

const wsUrl = JWT ? `${URL}?token=${encodeURIComponent(JWT)}` : URL;
let ws: WebSocket;
let reconnectAttempts = 0;
const MAX_RECONNECTS = 10;
let intentionalClose = false;

// ─── Command Completion ──────────────────────────────────────────────

const COMMANDS = [
  "/help", "/h",
  "/join", "/j",
  "/leave", "/l",
  "/switch", "/s",
  "/rooms", "/r",
  "/members", "/m",
  "/users", "/u",
  "/dm", "/d",
  "/create", "/c",
  "/history",
  "/debug",
  "/role", "/setrole",
  "/grant",
  "/myrole", "/whoami",
  "/permissions", "/perms",
  "/restrict",
  "/mention", "/at",
  "/quit", "/q", "/exit",
];

function completer(line: string): [string[], string] {
  if (!line.startsWith("/")) {
    return [[], line];
  }
  const hits = COMMANDS.filter((cmd) => cmd.startsWith(line));
  return [hits.length > 0 ? hits : COMMANDS, line];
}

const rl = DAEMON
  ? null
  : readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      terminal: true,
    });

if (rl) {
  // Bug fix: handle stdin close gracefully instead of crashing with ERR_USE_AFTER_CLOSE
  rl.on("close", () => {
    rlClosed = true;
    process.exit(0);
  });
}

// ─── Input Handler ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleInput(input: string) {
  promptActive = false;
  const trimmed = input.trim();

  if (!trimmed) {
    showPrompt();
    return;
  }

  if (trimmed.startsWith("/")) {
    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case "quit":
      case "exit":
      case "q":
        console.log(`\n${DIM}Goodbye!${R}`);
        intentionalClose = true;
        ws.close();
        rl?.close();
        process.exit(0);
        break;

      case "help":
      case "h":
        printHelp();
        break;

      case "join":
      case "j":
        if (!parts[1]) {
          printMsg(`${RED}  Usage: /join <room>${R}`);
          break;
        }
        if (JWT) {
          ws.send(JSON.stringify({ type: "action", payload: { action: "join", channelId: parts[1] } }));
        } else {
          sendAction("room.join", { room_id: parts[1] });
        }
        break;

      case "leave":
      case "l": {
        const leaveTarget = parts[1] ?? activeRoom;
        if (JWT) {
          ws.send(JSON.stringify({ type: "action", payload: { action: "leave", channelId: leaveTarget } }));
        } else {
          sendAction("room.leave", { room_id: leaveTarget });
        }
        break;
      }

      case "switch":
      case "s":
        if (!parts[1]) {
          printMsg(`${RED}  Usage: /switch <room>${R}`);
          break;
        }
        if (JWT) {
          if (!joinedRooms.has(parts[1])) {
            printMsg(`${YELLOW}  Not in #${parts[1]}. Join first with /join ${parts[1]}${R}`);
          } else {
            ws.send(JSON.stringify({ type: "action", payload: { action: "leave", channelId: activeRoom } }));
            ws.send(JSON.stringify({ type: "action", payload: { action: "join", channelId: parts[1] } }));
          }
        } else {
          if (!joinedRooms.has(parts[1])) {
            printMsg(`${YELLOW}  Not in #${parts[1]}. Join first with /join ${parts[1]}${R}`);
          } else {
            activeRoom = parts[1];
            printMsg(`${GREEN}  Switched to #${activeRoom}${R}`);
          }
        }
        break;

      case "rooms":
      case "r":
        if (JWT) {
          ws.send(JSON.stringify({ type: "action", payload: { action: "list_channels" } }));
        } else {
          sendAction("room.list", {});
        }
        break;

      case "members":
      case "m":
        sendAction("room.members", { room_id: parts[1] ?? activeRoom });
        break;

      case "users":
      case "u":
        sendAction("users.list", {});
        break;

      case "dm":
      case "d": {
        if (!parts[1] || !parts[2]) {
          printMsg(`${RED}  Usage: /dm <user> <message>${R}`);
          printMsg(`${DIM}  Multiple users: /dm user1,user2,user3 <message>${R}`);
          printMsg(`${DIM}  Array syntax: /dm [user1,user2] <message>${R}`);
          break;
        }
        const recipientsRaw = parts[1];
        let recipients: string[] = [];
        let messageStartIndex = 2;

        if (recipientsRaw.startsWith("[")) {
          const fullRecipients = parts.slice(1).join(" ");
          const closeBracket = fullRecipients.indexOf("]");
          if (closeBracket !== -1) {
            const userList = fullRecipients.slice(1, closeBracket);
            recipients = userList.split(",").map((u) => u.trim()).filter((u) => u);
            const afterBracket = fullRecipients.slice(closeBracket + 1).trim();
            messageStartIndex = parts.length - afterBracket.split(/\s+/).length;
          } else {
            printMsg(`${RED}  Invalid array syntax. Use: /dm [user1,user2] message${R}`);
            break;
          }
        } else if (recipientsRaw.includes(",")) {
          recipients = recipientsRaw.split(",").map((u) => u.trim()).filter((u) => u);
        } else {
          recipients = [recipientsRaw];
        }

        const dmMessage = parts.slice(messageStartIndex).join(" ");
        if (!dmMessage) {
          printMsg(`${RED}  Message cannot be empty${R}`);
          break;
        }

        if (recipients.length === 1) {
          sendAction("dm", { to: recipients[0], message: dmMessage });
        } else {
          sendAction("permission.send_restricted", {
            room_id: activeRoom,
            message: dmMessage,
            visibility: "user_based",
            allowed_users: recipients,
          });
        }
        break;
      }

      case "create":
      case "c":
        if (!parts[1]) {
          printMsg(`${RED}  Usage: /create <room_id> [name]${R}`);
          break;
        }
        sendAction("room.create", {
          room_id: parts[1],
          name: parts.slice(2).join(" ") || parts[1],
        });
        break;

      case "history":
        sendAction("room.members", { room_id: activeRoom });
        printMsg(`${DIM}  (History is sent on room join. Use /leave then /join to refresh.)${R}`);
        break;

      case "debug":
        showDebug = !showDebug;
        printMsg(`${DIM}  Debug mode: ${showDebug ? "ON — signaling messages visible" : "OFF — signaling hidden"}${R}`);
        break;

      case "role":
      case "setrole":
        if (!parts[1] || !parts[2]) {
          printMsg(`${RED}  Usage: /role <user> <role>${R}`);
          printMsg(`${DIM}  Roles: owner, admin, member, guest${R}`);
          break;
        }
        sendAction("permission.set_role", {
          room_id: activeRoom,
          user_id: parts[1],
          role: parts[2].toLowerCase(),
        });
        break;

      case "grant":
        if (!parts[1] || !parts[2]) {
          printMsg(`${RED}  Usage: /grant <user> <role>${R}`);
          printMsg(`${DIM}  Roles: admin, member, guest${R}`);
          break;
        }
        sendAction("permission.set_role", {
          room_id: activeRoom,
          user_id: parts[1],
          role: parts[2].toLowerCase(),
        });
        break;

      case "myrole":
      case "whoami":
        sendAction("permission.get_my_permissions", { room_id: activeRoom });
        break;

      case "permissions":
      case "perms":
        sendAction("permission.get_room_config", { room_id: activeRoom });
        break;

      case "restrict": {
        if (!parts[1]) {
          printMsg(`${RED}  Usage: /restrict <message> [visibility] [roles/users]${R}`);
          printMsg(`${DIM}  visibility: public, role_based, user_based${R}`);
          printMsg(`${DIM}  Example: /restrict "Admin only" role_based admin${R}`);
          break;
        }
        const restrictMsg = parts.slice(1).join(" ").split(/["']/).filter((s) => s.trim())[0];
        const restrictVisibility =
          parts[parts.indexOf(restrictMsg.split(" ")[0]) + restrictMsg.split(" ").length + 1] ??
          "role_based";
        const restrictTarget = parts.slice(parts.indexOf(restrictVisibility) + 1);
        sendAction("permission.send_restricted", {
          room_id: activeRoom,
          message: restrictMsg,
          visibility: restrictVisibility,
          allowed_roles: restrictVisibility === "role_based" ? restrictTarget : undefined,
          allowed_users: restrictVisibility === "user_based" ? restrictTarget : undefined,
        });
        break;
      }

      case "mention":
      case "at": {
        if (!parts[1]) {
          printMsg(`${RED}  Usage: /mention <user> [message]${R}`);
          printMsg(`${DIM}  Example: /mention Alice Hello there!${R}`);
          printMsg(`${DIM}  Or just type: @Alice Hello there!${R}`);
          break;
        }
        const mentionUser = parts[1];
        const mentionMessage =
          parts.length > 2 ? `@${mentionUser} ${parts.slice(2).join(" ")}` : `@${mentionUser}`;
        const mentionsList = extractMentions(mentionMessage);
        send({
          type: "chat",
          from: NAME,
          to: `room:${activeRoom}`,
          payload: {
            message: mentionMessage,
            room: activeRoom,
            mentions: mentionsList.length > 0 ? mentionsList : undefined,
          },
        });
        break;
      }

      default:
        printMsg(`${RED}  Unknown command: /${cmd}. Type /help for commands.${R}`);
    }

    showPrompt();
    return;
  }

  // ── Chat message → active room ─────────────────────────────────────

  if (!joinedRooms.has(activeRoom)) {
    printMsg(`${YELLOW}  Not in #${activeRoom}. Join with /join ${activeRoom}${R}`);
    showPrompt();
    return;
  }

  if (JWT) {
    ws.send(JSON.stringify({
      type: "chat",
      channel: activeRoom,
      payload: { content: trimmed, mentions: extractMentions(trimmed) },
      ts: new Date().toISOString(),
    }));
  } else {
    const mentions = extractMentions(trimmed);
    send({
      type: "chat",
      from: NAME,
      to: `room:${activeRoom}`,
      payload: {
        message: trimmed,
        room: activeRoom,
        mentions: mentions.length > 0 ? mentions : undefined,
      },
    });
  }
  showPrompt();
}

// ─── Message Display ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function displayMessage(msg: any) {
  const p = msg.payload;

  // ── Full-stack WS message types ────────────────────────────────────
  if (JWT) {
    switch (msg.type) {
      case "response": {
        const action = p?.action;
        if (action === "connect") {
          if (p.success) {
            authenticated = true;
            userId = p.entityId ?? "";
            printMsg(`${GREEN}  ✓ Connected as ${p.entityName}${userId ? ` (${userId})` : ""}${R}`);
            schedulePrompt();
          } else {
            printMsg(`${RED}  ✗ Connection failed${R}`);
          }
          return;
        }
        if (action === "join") {
          const channelId = p.channelId ?? p.channel;
          joinedRooms.add(channelId);
          activeRoom = channelId;
          printMsg(`${GREEN}  → Joined #${channelId}${R}`);
          schedulePrompt();
          return;
        }
        if (action === "leave") {
          const channelId = p.channelId ?? p.channel;
          joinedRooms.delete(channelId);
          if (activeRoom === channelId && joinedRooms.size > 0) {
            activeRoom = [...joinedRooms][0];
            printMsg(`${DIM}  Left #${channelId}, switched to #${activeRoom}${R}`);
          } else if (joinedRooms.size === 0) {
            printMsg(`${DIM}  Left #${channelId}. No active rooms.${R}`);
          } else {
            printMsg(`${DIM}  Left #${channelId}${R}`);
          }
          return;
        }
        if (action === "list_channels") {
          const channels = p.channels ?? p.data;
          if (Array.isArray(channels)) {
            printMsg(`${DIM}  ┌ Channels ─────────────────────────────${R}`);
            for (const ch of channels) {
              const id = ch.id ?? ch.channelId ?? ch;
              const name = ch.name ?? id;
              const badge = joinedRooms.has(id) ? `${GREEN}●${R}` : `${DIM}○${R}`;
              printMsg(`  ${badge} ${BOLD}#${id}${R}  ${DIM}${name}${R}`);
            }
            printMsg(`${DIM}  └─────────────────────────────────────${R}`);
          }
          return;
        }
        if (showDebug) {
          printMsg(`${DIM}${timestamp()} [rsp:${action}] ${JSON.stringify(p)}${R}`);
        }
        return;
      }

      case "chat": {
        const ts = `${DIM}${timestamp()}${R}`;
        const content = p?.content ?? "";
        const senderName = p?.senderName ?? p?.sender ?? "?";
        const channel = msg.channel ?? p?.channel ?? activeRoom;
        const message = highlightMentions(content, NAME);
        const roomTag = joinedRooms.size > 1 ? `${BLUE}#${channel}${R} ` : "";
        printMsg(`${ts} ${roomTag}${CYAN}${senderName}${R}  ${message}`);
        return;
      }

      case "signal": {
        const event = p?.event;
        const entityName = p?.entityName ?? p?.name ?? "?";
        const channelId = p?.channelId ?? p?.channel ?? "";
        if (event === "join") {
          printMsg(`${DIM}${timestamp()} → ${entityName} joined #${channelId}${R}`);
        } else if (event === "leave") {
          printMsg(`${DIM}${timestamp()} ← ${entityName} left #${channelId}${R}`);
        } else if (showDebug) {
          printMsg(`${DIM}${timestamp()} [sig:${event}] ${JSON.stringify(p)}${R}`);
        }
        return;
      }

      case "error": {
        printMsg(`${RED}  ✗ Error: ${p?.message ?? JSON.stringify(p)}${R}`);
        return;
      }

      default:
        if (showDebug) {
          printMsg(`${DIM}${timestamp()} [${msg.type}] ${JSON.stringify(p)}${R}`);
        }
        return;
    }
  }

  // ── Simple-service message types ───────────────────────────────────
  switch (msg.type) {
    case "chat": {
      const isDm = !!p.dm;
      const room = p.room ?? (msg.to?.startsWith("room:") ? msg.to.slice(5) : null);
      const rawMessage = p.message ?? "";
      const mentions = p.mentions;
      const ts = `${DIM}${timestamp()}${R}`;
      const message = highlightMentions(rawMessage, NAME);
      const isMentioned = mentions?.includes(NAME);
      const mentionIndicator = isMentioned ? ` ${YELLOW}[@]${R}` : "";

      if (isDm) {
        if (msg.from === NAME) {
          printMsg(`${ts} ${MAGENTA}[DM → ${msg.to}]${R} ${message}`);
        } else {
          printMsg(`${ts} ${MAGENTA}[DM from ${msg.from}]${R} ${WHITE}${message}${R}`);
        }
      } else if (room) {
        if (msg.from === NAME) return;
        const roomTag = joinedRooms.size > 1 ? `${BLUE}#${room}${R} ` : "";
        printMsg(`${ts} ${roomTag}${CYAN}${msg.from}${R}${mentionIndicator}  ${message}`);
      } else {
        printMsg(`${ts} ${CYAN}${msg.from}${R}${mentionIndicator}  ${message}`);
      }
      break;
    }

    case "system": {
      const event = p.event;
      switch (event) {
        case "welcome":
          break;
        case "user.joined":
          printMsg(`${DIM}${timestamp()} → ${p.user_name} joined #${p.room_id}${R}`);
          break;
        case "user.left":
          printMsg(`${DIM}${timestamp()} ← ${p.user_name} left #${p.room_id}${R}`);
          break;
        case "user.role_changed":
          printMsg(
            `${DIM}${timestamp()} ${YELLOW}⚡${R} ${p.user_name} role changed: ${getRoleColor(p.old_role)}${p.old_role}${R} → ${getRoleColor(p.new_role)}${p.new_role}${R} in #${p.room_id}${R}`,
          );
          break;
        case "room.history": {
          const msgs = p.messages;
          if (msgs && msgs.length > 0) {
            printMsg(`${DIM}── History #${p.room_id} (${msgs.length} messages) ──${R}`);
            for (const hm of msgs) {
              const hp = hm.payload;
              const ht = new Date(hm.timestamp).toLocaleTimeString("en-US", { hour12: false });
              printMsg(`${DIM}  ${ht} ${hm.from}: ${hp.message}${R}`);
            }
            printMsg(`${DIM}── End history ──${R}`);
          }
          break;
        }
        default:
          if (showDebug) {
            printMsg(`${DIM}${timestamp()} [sys:${event}] ${JSON.stringify(p)}${R}`);
          }
      }
      break;
    }

    case "response": {
      const action = p.action;
      const success = p.success;
      switch (action) {
        case "auth":
          if (success) {
            authenticated = true;
            userId = p.data?.user_id ?? "";
            const authRooms = p.data?.rooms;
            printMsg(`${GREEN}  ✓ Authenticated as "${NAME}" (${userId})${R}`);
            if (authRooms && authRooms.length > 0) {
              printMsg(`${DIM}  Rooms: ${authRooms.map((r: { id: string }) => r.id).join(", ")}${R}`);
            }
            sendAction("room.join", { room_id: ROOM });
          } else {
            printMsg(`${RED}  ✗ Auth failed: ${p.error}${R}`);
          }
          break;

        case "room.join":
          if (success) {
            const roomId = p.data?.room_id;
            const members = p.data?.members;
            joinedRooms.add(roomId);
            activeRoom = roomId;
            printMsg(`${GREEN}  ✓ Joined #${roomId}${R}${members ? `${DIM} — ${members.join(", ")}${R}` : ""}`);
          } else {
            printMsg(`${YELLOW}  ${p.error}${R}`);
          }
          break;

        case "room.leave":
          if (success) {
            const roomId = p.data?.room_id;
            joinedRooms.delete(roomId);
            if (activeRoom === roomId && joinedRooms.size > 0) {
              activeRoom = [...joinedRooms][0];
              printMsg(`${DIM}  Left #${roomId}, switched to #${activeRoom}${R}`);
            } else if (joinedRooms.size === 0) {
              printMsg(`${DIM}  Left #${roomId}. No active rooms.${R}`);
            } else {
              printMsg(`${DIM}  Left #${roomId}${R}`);
            }
          } else {
            printMsg(`${YELLOW}  ${p.error}${R}`);
          }
          break;

        case "room.create":
          if (success) {
            const createdRoom = p.data;
            printMsg(`${GREEN}  ✓ Room created: #${createdRoom.id}${R}`);
            printMsg(`${DIM}  → Auto-joining #${createdRoom.id}...${R}`);
            sendAction("room.join", { room_id: createdRoom.id });
          } else {
            printMsg(`${YELLOW}  ${p.error}${R}`);
          }
          break;

        case "room.list": {
          const rooms = p.data?.rooms;
          if (rooms) {
            printMsg(`${DIM}  ┌ Rooms ────────────────────────────${R}`);
            for (const r of rooms) {
              const badge = joinedRooms.has(r.id) ? `${GREEN}●${R}` : `${DIM}○${R}`;
              printMsg(`  ${badge} ${BOLD}#${r.id}${R}  ${DIM}${r.description || r.name}  (${r.memberCount} online)${R}`);
            }
            printMsg(`${DIM}  └─────────────────────────────────${R}`);
          }
          break;
        }

        case "room.members": {
          const members = p.data?.members;
          const roomId = p.data?.room_id;
          if (members) {
            printMsg(`${DIM}  Members of #${roomId}: ${members.join(", ")}${R}`);
          }
          break;
        }

        case "users.list": {
          const users = p.data?.users;
          if (users) {
            printMsg(`${DIM}  ┌ Online Users ─────────────────────${R}`);
            for (const u of users) {
              const isSelf = u.name === NAME ? ` ${GREEN}(you)${R}` : "";
              printMsg(`  ${CYAN}${u.name}${R}${isSelf}  ${DIM}in ${u.rooms.map((r: string) => `#${r}`).join(", ") || "(lobby)"}${R}`);
            }
            printMsg(`${DIM}  └─────────────────────────────────${R}`);
          }
          break;
        }

        case "dm":
          if (!success) {
            printMsg(`${RED}  DM failed: ${p.error}${R}`);
          }
          break;

        case "ping":
          break;

        case "permission.set_role":
          if (success) {
            printMsg(`${GREEN}  ✓ Role updated: ${p.data.userId} → ${p.data.newRole}${R}`);
          } else {
            printMsg(`${RED}  ✗ Failed to set role: ${p.error}${R}`);
          }
          break;

        case "permission.get_my_permissions": {
          if (success) {
            const data = p.data;
            const role = data.role;
            const perms = data.permissions;
            printMsg(`${DIM}  ┌ Your Permissions in #${data.room_id} ────${R}`);
            printMsg(`  ${BOLD}Role:${R} ${getRoleColor(role)}${role}${R}`);
            printMsg(`  ${BOLD}Capabilities:${R}`);
            if (perms) {
              const categories: Record<string, string[]> = {
                "Messaging": ["send_message", "send_restricted_message"],
                "Moderation": ["delete_message", "edit_message", "pin_message"],
                "Management": ["invite_member", "kick_member", "modify_permissions"],
                "Access": ["view_history", "view_members", "send_dm"],
              };
              for (const [category, actions] of Object.entries(categories)) {
                const relevantPerms = actions.filter((a) => perms[a] !== undefined);
                if (relevantPerms.length > 0) {
                  printMsg(`    ${BOLD}${category}:${R}`);
                  for (const perm of relevantPerms) {
                    const value = perms[perm];
                    const icon = value ? `${GREEN}✓${R}` : `${DIM}✗${R}`;
                    const permName = perm.replace(/_/g, " ");
                    printMsg(`      ${icon} ${permName}`);
                  }
                }
              }
            }
            printMsg(`${DIM}  └──────────────────────────────────${R}`);
          } else {
            printMsg(`${RED}  ✗ Failed to get permissions: ${p.error}${R}`);
          }
          break;
        }

        case "permission.get_room_config": {
          if (success) {
            const data = p.data;
            const config = data.config;
            const perms = data.permissions;
            printMsg(`${DIM}  ┌ Room Configuration #${data.room_id} ───${R}`);
            if (config) {
              printMsg(`  ${BOLD}Settings:${R}`);
              printMsg(`    Default Role: ${getRoleColor(config.defaultRole)}${config.defaultRole}${R}`);
              printMsg(`    Default Visibility: ${config.defaultVisibility}`);
              printMsg(`    Message Rate Limit: ${config.messageRateLimit}/min`);
              if (config.memberHistoryLimit > 0) {
                printMsg(`    History Limit: ${config.memberHistoryLimit} messages`);
              }
            }
            if (perms) {
              printMsg(`  ${BOLD}Who Can:${R}`);
              const actions: Record<string, string[]> = {
                "Send messages": perms.canSendMessage,
                "Delete messages": perms.canDeleteMessages,
                "Invite members": perms.canInviteMembers,
                "Kick members": perms.canKickMembers,
                "Modify permissions": perms.canModifyPermissions,
              };
              for (const [actionName, roles] of Object.entries(actions)) {
                if (roles && Array.isArray(roles)) {
                  const roleStr = roles.map((r: string) => getRoleColor(r) + r + R).join(", ");
                  printMsg(`    ${actionName}: ${roleStr}`);
                }
              }
            }
            printMsg(`${DIM}  └──────────────────────────────────${R}`);
          } else {
            printMsg(`${RED}  ✗ Failed to get config: ${p.error}${R}`);
          }
          break;
        }

        case "permission.send_restricted":
          if (success) {
            printMsg(`${GREEN}  ✓ Restricted message sent${R}`);
          } else {
            printMsg(`${RED}  ✗ Failed to send restricted message: ${p.error}${R}`);
          }
          break;

        default:
          if (showDebug) {
            printMsg(`${DIM}${timestamp()} [rsp:${action}] ${success ? "ok" : p.error}${R}`);
          }
      }
      break;
    }

    case "error": {
      printMsg(`${RED}  ✗ Error ${p.code}: ${p.message}${R}`);
      break;
    }

    default:
      if (showDebug) {
        printMsg(`${DIM}${timestamp()} [${msg.type}] ${JSON.stringify(p)}${R}`);
      }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function send(data: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendAction(action: string, data: object) {
  send({ type: "action", from: NAME, payload: { action, ...data } });
}

// Bug fix: pad command column to 20 chars so name and description never concatenate
function printHelp() {
  const col = 20;
  const entries: [string, string][] = [
    ["/join <room>", "Join a room"],
    ["/leave [room]", "Leave current or specified room"],
    ["/switch <room>", `Switch active room (short: ${DIM}/s${R})`],
    ["/rooms", "List all rooms"],
    ["/members [room]", "Show room members"],
    ["/users", "List online users"],
    ["/create <id> [name]", "Create a new room"],
    ["/history", "Show current room history"],
  ];
  const msgEntries: [string, string][] = [
    ["/dm <user> <msg>", "Send private message"],
    ["/dm user1,user2 ...", "Send to multiple users"],
    ["/mention <user> ...", "Mention a user (@user)"],
  ];
  const permEntries: [string, string][] = [
    ["/role <user> <role>", "Set user role (owner/admin/member/guest)"],
    ["/grant <user> <role>", "Grant role to user (alias)"],
    ["/myrole", "Show your role and permissions"],
    ["/permissions", "Show room permission config"],
    ["/restrict <msg> ...", "Send restricted message (advanced)"],
  ];
  const otherEntries: [string, string][] = [
    ["/debug", "Toggle signaling visibility"],
    ["/quit", "Exit"],
  ];

  function fmt(cmd: string, desc: string) {
    return `  ${GREEN}${cmd.padEnd(col)}${R}${desc}`;
  }

  printMsg(`
${BOLD}  Commands${R}
  ${DIM}─────────────────────────────────────────${R}
  ${BOLD}Room & Chat${R}
${entries.map(([c, d]) => fmt(c, d)).join("\n")}

  ${BOLD}Messaging${R}
${msgEntries.map(([c, d]) => fmt(c, d)).join("\n")}
  ${DIM}Or just type: @username in any message${R}

  ${BOLD}Permission Management${R}
${permEntries.map(([c, d]) => fmt(c, d)).join("\n")}

  ${BOLD}Other${R}
${otherEntries.map(([c, d]) => fmt(c, d)).join("\n")}

  ${DIM}Type plain text to send to the active room.${R}
  ${DIM}Press TAB to autocomplete commands.${R}
  ${DIM}Short aliases: /j /l /s /r /m /u /d /c /at /q /h${R}
  ${DIM}Permission shortcuts: /whoami = /myrole, /perms = /permissions${R}
`);
}

// ─── WebSocket Events ────────────────────────────────────────────────

function connectWs(): void {
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    connected = true;
    reconnectAttempts = 0;
    console.log(`${GREEN}  ● Connected${R}`);
    if (JWT) {
      ws.send(JSON.stringify({
        type: "action",
        payload: { action: "join", channelId: ROOM },
      }));
    } else {
      sendAction("auth", { name: NAME });
      setTimeout(() => {
        if (!authenticated) {
          console.log(`${YELLOW}  ⚠ Auth timeout — server may not support the expected protocol.${R}`);
          console.log(`${DIM}  Make sure you are connecting to an AgentRoom Service.${R}`);
        }
      }, 5000);
    }
  });

  ws.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString("utf-8"));
      displayMessage(msg);
    } catch {
      // ignore non-JSON frames
    }
  });

  ws.on("close", () => {
    connected = false;
    authenticated = false;
    if (intentionalClose || rlClosed || !JWT) {
      console.log(`\n${YELLOW}  Disconnected from server.${R}`);
      if (!intentionalClose) rl?.close();
      process.exit(0);
      return;
    }
    if (reconnectAttempts >= MAX_RECONNECTS) {
      console.log(`\n${RED}  Max reconnect attempts reached. Exiting.${R}`);
      process.exit(1);
      return;
    }
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
    reconnectAttempts++;
    console.log(`\n${YELLOW}  Disconnected. Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${reconnectAttempts})${R}`);
    setTimeout(connectWs, delay);
  });

  ws.on("error", (err: Error) => {
    console.error(`\n${RED}  Connection error: ${err.message}${R}`);
    if (!connected) {
      console.log(`${DIM}  Make sure the service is running: pnpm run service${R}`);
    }
  });
}

connectWs();

// ─── Keepalive ───────────────────────────────────────────────────────

setInterval(() => {
  if (connected && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping" }));
  }
}, 30_000);
