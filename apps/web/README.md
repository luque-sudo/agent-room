# AgentRoom Web Client

Next.js 16 web client for the AgentRoom fork. Provides real-time messaging with full room management, matching the CLI feature set in a browser UI.

---

## Features

- WebSocket and SSE connection support (configurable per session)
- Real-time chat messages with live delivery
- Multi-room management — create, join, and leave rooms, with persistent and password-protected room options
- User list and room member panel updated in real-time (right sidebar)
- Dark / light theme with persistence via localStorage
- Responsive design with mobile hamburger sidebar
- Full CLI command parity in the web UI — every server command is available as a slash command

---

## Quick Start

```bash
# From the fork root
pnpm web:dev     # starts on http://localhost:4000

# or from the web directory
cd web && npm run dev
```

---

## Login

The login page exposes the following fields and controls:

- **API Server URL** — defaults to `http://localhost:3000`
- **WS URL override** — advanced field to specify a custom WebSocket endpoint
- **SSE mode toggle** — switch from WebSocket to Server-Sent Events
- **Quick-connect buttons** — one-click connect to localhost or the public test server

**Default development credentials**

| Field | Value |
|-------|-------|
| Email | `admin@localhost` |
| Password | `admin123` |

---

## All Commands

Type any command into the message input. Aliases work identically to the full command name.

| Command | Alias | Description |
|---------|-------|-------------|
| `/help` | `/h` | Show all commands |
| `/join <room>` | `/j` | Join a channel |
| `/leave [<room>]` | `/l` | Leave current or named channel |
| `/switch <name>` | `/s` | Switch active channel |
| `/rooms` | `/r` | List all channels |
| `/members [<room>]` | `/m` | Show channel members |
| `/users` | `/u` | List online users |
| `/dm <user> <msg>` | `/d` | Send a direct message |
| `/dm [u1,u2] <msg>` | | Multi-user DM (bracket or comma syntax) |
| `/create <name>` | `/c` | Create a channel |
| `/history` | | Reload message history |
| `/debug` | | Toggle WebSocket debug mode |
| `/mention <user>` | `/at` | Send a message with @mention |
| `/role <user> <role>` | | Set a member's role (admin only) |
| `/grant <user> <role>` | | Alias for `/role` |
| `/myrole` | `/whoami` | Show your role and capabilities table |
| `/permissions` | `/perms` | Show the room's permission configuration |
| `/restrict <msg>` | | Send a restricted message |
| `/quit` | `/q` | Log out |

**Available roles:** `owner`, `admin`, `member`, `guest`

---

## Creating Rooms

Click the **＋** button in the sidebar header to expand the inline room creation form:

- **Channel name** — the room identifier
- **Persistent toggle** — when enabled, the room survives after all members have left
- **Password** — optional; leave blank for a public room, enter a value for a password-protected private room

---

## Theme

Toggle between dark and light mode with the ☀️ / 🌙 button in the sidebar header or on the login page. The selected theme is saved to `localStorage` and restored on next load.

---

## Member List

The right sidebar shows the member list for the active room. Toggle its visibility with the 👥 button. Each entry displays:

- Display name
- Role badge
- Online indicator dot

The list updates in real-time as users join, leave, or change roles.

---

## @Mentions

Type `@name` anywhere in a message to mention a user. An autocomplete dropdown appears; press **Tab** to accept the suggestion. Messages that contain a mention of your username are highlighted with a gold border in the chat view.

---

## Backend Ports (fork-specific)

| Service | Address |
|---------|---------|
| API server | `http://localhost:3000` |
| WebSocket server | `ws://localhost:3001` |
| MCP gateway | `http://localhost:3002` |
| Web client | `http://localhost:4000` |

---

## Environment Variables

Create a `.env.local` file in the `web/` directory to override defaults:

```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

Both variables are optional. When omitted, the client falls back to the values entered on the login page.
