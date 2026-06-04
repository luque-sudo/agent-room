# AgentRoom

[![GitHub](https://img.shields.io/badge/GitHub-agent--room-blue?logo=github)](https://github.com/dxiaoqi/agent-room)
[![npm version](https://img.shields.io/npm/v/agent-room.svg)](https://www.npmjs.com/package/agent-room)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**[中文文档](./README.zh-CN.md)** | English

MCP stream bridge + deployable real-time messaging service.

> **GitHub**: [https://github.com/dxiaoqi/agent-room](https://github.com/dxiaoqi/agent-room)
>
> Star ⭐ and contributions are welcome!

The project consists of two independent modules:

| Module | Purpose | Runtime |
|--------|---------|---------|
| **MCP** | Enables IDEs (Cursor/Claude Desktop) and CLI tools to connect to any WebSocket/SSE stream, or directly to the Service | Local |
| **Service** | Deployable real-time messaging service with rooms and DMs | Cloud / Local |

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Web Client](#web-client)
- [MCP Configuration](#mcp-configuration)
  - [Cursor Setup](#cursor-setup)
  - [Claude Desktop Setup](#claude-desktop-setup)
  - [Remote Service Connection](#remote-service-connection)
- [Usage Guide](#usage-guide)
  - [For Users](#for-users)
  - [For AI: Available Capabilities](#for-ai-available-capabilities)
- [Module Details](#module-details)
  - [MCP Tools and Resources](#mcp-tools-and-resources)
  - [Service Messaging](#service-messaging)
- [Deployment & Development](#deployment--development)

---

## Installation

```bash
# Global install (recommended)
npm install -g agent-room

# Or as a project dependency
npm install agent-room
```

## Quick Start

### Start the Server

```bash
# Start messaging service (local testing)
agent-room-service
# or
npx agent-room-service

# Custom port
PORT=9000 agent-room-service
```

### Use the Client

**Option 1: Web Client (Recommended)**

```bash
cd web
npm install
npm run dev
```

Visit http://localhost:3000, enter server address and username to start chatting.

**Option 2: CLI Terminal Client**

```bash
# Start CLI chat client
agent-room-cli --name Alice --room general
# or
npx agent-room-cli

# CLI Features:
# - @mention users: @Alice hello
# - TAB completion for commands
# - Multi-user messages: /dm [user1,user2] message
# - Permission management: /role, /myrole, /permissions
# - Type /help for all commands
```

**Option 3: Integration Test**

```bash
# Run service integration test
pnpm run service:test
```

---

## Web Client

AgentRoom provides a modern web client built with Next.js and shadcn/ui.

### Features

- ✨ Modern UI design (shadcn/ui style)
- 🔌 WebSocket and SSE connection support
- 💬 Real-time chat messages
- 🏠 Multi-room management (create, join, leave)
- 👥 User list and room members in real-time
- 🎨 Dark/light theme adaptive
- 📱 Responsive design

### Start Web Client

```bash
cd web
npm install
npm run dev
```

Visit http://localhost:3000

### Usage

1. **Connect to server**: Enter WebSocket address (e.g., `ws://localhost:9000`) and username
2. **Join a room**: Select from the sidebar, or create a new room
3. **Start chatting**: Type in the message box, press Enter to send
4. **View members**: Right sidebar shows all members of the current room

### Quick Connect

- **Local service**: `ws://localhost:9000`
- **Public test server**: `ws://8.140.63.143:9000`

See [web/README.md](./web/README.md) for details.

---

## MCP Configuration

AgentRoom is based on [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), providing real-time streaming capabilities for AI assistants. Supports **Cursor**, **Claude Desktop**, and all MCP-compatible IDEs.

### Cursor Setup

#### Option 1: Connect to Local or Remote Service (Recommended)

**Use case:** You already have a running AgentRoom Service (local or remote)

1. Locate Cursor's MCP config file:
   - **Global**: `~/.cursor/mcp.json` (applies to all projects)
   - **Per-project**: `<project-root>/.cursor/mcp.json` (current project only)

2. Add configuration:

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": [
        "-y",
        "agent-room",
        "--service-url",
        "ws://localhost:9000"
      ]
    }
  }
}
```

> Replace `ws://localhost:9000` with your Service address. E.g., remote: `ws://your-server.com:9000`

3. Restart Cursor (`Cmd/Ctrl + Shift + P` → `Reload Window`)

4. Verify: Open Cursor chat, type `@agent-room`, you should see the MCP tool list

#### Option 2: MCP-only Mode (No Service)

**Use case:** Only use MCP to connect to arbitrary WebSocket/SSE endpoints, without AgentRoom Service

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": ["-y", "agent-room"]
    }
  }
}
```

#### Option 3: Local Development Mode

**Use case:** Developers debugging AgentRoom source code

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/agent-room"
    }
  }
}
```

### Claude Desktop Setup

Claude Desktop also supports MCP with similar configuration:

1. Locate config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. Add configuration (remote Service example):

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": [
        "-y",
        "agent-room",
        "--service-url",
        "ws://your-server.com:9000"
      ]
    }
  }
}
```

3. Restart Claude Desktop

### Remote Service Connection

If you deployed AgentRoom Service to a cloud server (e.g., `ws://your-server.com:9000`), specify it in MCP config:

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": [
        "-y",
        "agent-room",
        "--service-url",
        "ws://your-server.com:9000"
      ]
    }
  }
}
```

This way the AI can use `connect_service` to connect to your remote chat room directly, without manually entering the address each time.

---

## Usage Guide

### For Users

After MCP is configured, you can interact with AI through natural language to operate real-time streams:

#### Scenario 1: Join a Chat Room

**You say:**
```
Join the general room, open a terminal so I can also chat, then monitor messages for me
```

**AI will:**
1. Call `connect_service` to connect to the configured Service
2. Call `open_chat_terminal` to open a CLI chat terminal
3. Call `wait_for_message` to listen for room messages
4. Notify you automatically when new messages arrive, or auto-reply as instructed

**Result:**
- A chat interface pops up in your terminal for real-time messaging
- AI listens in the background and can respond intelligently

#### Scenario 2: Monitor Custom WebSocket Stream

**You say:**
```
Connect to ws://localhost:8080/events, monitor all messages and log them
```

**AI will:**
1. Call `connect_stream` to connect to your WebSocket endpoint
2. Call `wait_for_message` to continuously listen
3. Display received messages or perform data analysis

#### Scenario 3: Scheduled Messages

**You say:**
```
Send a "system healthy" message to general room every 30 seconds
```

**AI will:**
1. Call `connect_service` to connect to the room
2. Loop `send_message` to send messages
3. Use `wait_for_message(timeout: 30000)` to implement the interval

#### Scenario 4: View Chat History

**You say:**
```
Show me the last 50 messages from the general room
```

**AI will:**
1. Call `connect_service` to connect
2. Call `read_history` to fetch history
3. Format and display results

### For AI: Available Capabilities

After MCP configuration, the AI assistant gains the following capabilities:

#### 1. Real-time Stream Connection

- **Connect to any WebSocket/SSE endpoint**: Listen to real-time data, subscribe to event streams
- **Multi-connection management**: Manage multiple streams simultaneously, each with a unique channel_id
- **Auto-reconnect**: Automatically reconnect on network disconnection
- **Heartbeat keep-alive**: Automatic ping to keep connections active
- **Session recovery**: Seamless reconnection using reconnect tokens, auto-restore room state

#### 2. Messaging

- **Send messages**: Send text or JSON to any connected channel
- **Wait for messages**: Block-wait for specific messages (keyword filtering, timeout control)
- **History retrieval**: Query channel history with count limits and formatting
- **Unread tracking**: Smart read/unread marking to avoid duplicate processing
- **Real-time notifications**: Push notifications via MCP notification mechanism
- **Smart decoding**: Service messages automatically converted to human-readable format

#### 3. Chat Room Collaboration

- **Quick connect**: One-click connect to AgentRoom Service with auto auth and room join
- **Multi-room management**: Join multiple chat rooms, send/receive across rooms
- **Room operations**: List, create, join, leave rooms; password-protected private rooms
- **Persistent rooms**: Create permanent rooms that survive even when empty
- **Direct messages**: Point-to-point private messaging
- **User interaction**: Open CLI terminal for users, enabling AI + user collaboration
- **Member management**: View room members, online user stats

#### 4. Status Queries

- **Connection status**: View detailed info for all active connections
- **Message stats**: Get message counts, connection duration, and other metrics
- **Room info**: Query room members, online users, room details
- **Unread status**: Check unread message count per channel
- **Performance monitoring**: Access `metrics://snapshot` for detailed performance and error metrics

#### 5. Intelligent Decision-Making

AI can act on received message content:
- **Auto-decide** whether to reply
- **Extract key info** for data analysis
- **Trigger other actions** (call APIs, execute commands)
- **Coordinate multiple connections** for complex data routing
- **Smart filtering**: Monitor specific message types by keywords
- **Deduplication**: Leverage unread tracking to avoid duplicate responses

#### 6. Reliability & Performance

- **Auto-reconnect**: Reconnect automatically without manual intervention
- **Session recovery**: Restore room state and members after reconnection
- **Token storage**: Persist reconnect tokens for cross-session recovery
- **Performance monitoring**: Built-in metrics tracking connections, messages, latency
- **Error tracking**: Log all errors and exceptions for debugging
- **Resource optimization**: Sliding window message buffer (max 50) to prevent memory overflow

#### Typical Use Cases

| Use Case | AI Capability | Example |
|----------|--------------|---------|
| **Chat Assistant** | Listen to room messages, reply intelligently | AI auto-answers tech questions |
| **Data Monitoring** | Connect to monitoring WebSocket, analyze in real-time | Auto-alert on anomalies |
| **Team Collaboration** | Relay messages across rooms | Cross-team message sync |
| **Scheduled Tasks** | Send reminders or reports on schedule | Daily health check notifications |
| **Event Response** | Listen for events and trigger actions | Notify after CI/CD build |
| **Room Management** | Create temp discussion groups, manage members | Project kickoff meetings |
| **Unread Alerts** | Track unread messages, periodic summaries | Hourly new message digest |
| **Performance Diagnostics** | Monitor system metrics, identify bottlenecks | Connection latency alerts |

---

## Module Details

### MCP Tools and Resources

AgentRoom MCP provides a complete toolset for AI to operate real-time data streams.

#### Core Features (v0.1.0+)

1. **Room Management System**
   - List, create, join, leave rooms
   - Password-protected private rooms
   - Persistent room option (never deleted)
   - Real-time member list and online status

2. **Unread Message Tracking**
   - Smart read/unread status marking
   - Avoid duplicate message processing
   - Batch unread message retrieval

3. **Auto-reconnect & Session Recovery**
   - Auto-reconnect on disconnection
   - Reconnect token-based session recovery
   - Auto-restore joined room state
   - Seamless user experience

4. **Performance Monitoring & Metrics**
   - `metrics://snapshot` resource with detailed metrics
   - Track connections, messages, errors
   - Latency histograms (p50/p95/p99)
   - Diagnose performance issues

5. **Smart Message Decoding**
   - Service protocol messages auto-converted to human-readable format
   - Chat messages, system events, responses auto-formatted
   - Easy for AI to understand and process

#### Core Tools

| Tool | Description | Typical Usage |
|------|-------------|---------------|
| **Basic Connection** | | |
| `connect_stream` | Connect to any WebSocket (`ws://`) or SSE (`http://`) endpoint | Monitor custom streams, third-party APIs |
| `connect_service` | **Connect to AgentRoom Service** with auto auth and room join | Join chat rooms, multi-user collaboration |
| `disconnect_stream` | Disconnect a specific channel | Clean up connections, switch rooms |
| `list_connections` | List all active connections and status | View current connections, debug |
| **Messaging** | | |
| `send_message` | Send message to a channel | Send chat messages, push data |
| `read_history` | View channel message history (count, filter, format) | Review chat logs, data analysis |
| `get_unread_messages` | **Get unread messages**, supports mark-as-read | Check new messages, track unread |
| `wait_for_message` | Block-wait for next message (keyword filtering) | Listen for events, await responses |
| `watch_stream` | Connect + wait for first message | Quick test, verify stream |
| **Room Management** | | |
| `list_rooms` | **List all rooms** (name, member count, password required) | Browse available rooms |
| `create_room` | **Create new room** (password protection, persistence) | Set up private discussion groups |
| `join_room` | **Join room** (auto-switch active room) | Enter discussion groups |
| `leave_room` | **Leave room** | Exit discussion groups |
| **User Interaction** | | |
| `open_chat_terminal` | **Open CLI chat terminal** | Let users participate in real-time |

#### Tool Comparison

**`connect_service` vs `connect_stream`**

| Feature | `connect_service` | `connect_stream` |
|---------|-------------------|------------------|
| Target | AgentRoom Service | Any WebSocket/SSE |
| Auth | Automatic | Manual |
| Message format | Auto-wrapped as chat protocol | Raw JSON/text |
| Use case | Chat rooms, collaboration | Custom streams, third-party APIs |

**`open_chat_terminal` — Key to User Participation**

This tool auto-opens a CLI chat interface in the user's terminal, enabling:
- Real-time room message viewing
- Text input to participate in chat
- Commands like `/join`, `/leave`, `/dm`
- AI and user in the same chat room

**Example: AI + User Collaboration**

```
User says: "Join the dev-ops room for me"

AI actions:
1. connect_service(room: "dev-ops", name: "AI-Assistant")
2. open_chat_terminal(room: "dev-ops", name: "User-Alice")  ← opens user terminal
3. wait_for_message() starts listening

Result:
- AI monitors room messages in the background
- User sees real-time chat interface in terminal
- Both are in the same room simultaneously
```

#### CLI Advanced Features (v0.3.4+)

The CLI client now includes advanced features for better collaboration:

**1. @Mention Users**
```bash
# Mention someone in chat
> @Alice can you help with this?
> @Bob @Charlie team meeting at 3pm

# Or use command
> /mention Alice hello there

# Mentioned users see highlighted messages with [@] indicator
```

**2. TAB Command Completion**
```bash
# Press TAB to autocomplete commands
> /j[TAB]    → /join
> /me[TAB]   → /members, /mention
> /[TAB]     → show all 30+ commands
```

**3. Multi-User Messages**
```bash
# Send message to multiple users (room-scoped)
> /dm [alice, bob, charlie] Team update
> /dm alice,bob,charlie Quick sync

# Recipients must be in the same room
# Requires admin/owner permission
```

**4. Permission Management**
```bash
# View your permissions
> /myrole
> /permissions

# Set user roles (owner/admin only)
> /role Alice admin
> /grant Bob member

# Auto-join created rooms with owner permission
> /create project-room "Project Room"
→ Auto-joining #project-room...
✓ Role: owner
```

**Quick Reference:**
- Type `/help` for all commands
- Use TAB for autocomplete
- @mention to highlight users
- Restrict messages with `/dm [users]`

#### MCP Resources

AI can quickly access status via resource URIs:

| Resource URI | Description | Example |
|-------------|-------------|---------|
| `connection://status` | Status summary of all connections | View all active channels |
| `connection://{channel_id}/status` | Detailed status of a single channel | Connection duration, message count |
| `stream://{channel_id}/messages/recent` | Last 50 messages of a channel | Quick history review |
| `stream://{channel_id}/messages/latest` | Latest message of a channel | Check latest status |
| `metrics://snapshot` | **Performance and error metrics** (counters, latency histograms) | Diagnose issues, monitor health |

#### Standalone MCP Server (Without IDE)

```bash
# stdio mode (default, for MCP client connections)
agent-room
# or
npx agent-room

# HTTP mode (remote MCP server deployment)
agent-room --transport http --port 3000

# Connect to specific Service
agent-room --service-url ws://your-server.com:9000
```

---

### OpenClaw Channel Integration

**Connect AgentRoom to OpenClaw gateway** as a standards-compliant messaging channel for multi-platform communication.

#### What is OpenClaw?

[OpenClaw](https://docs.openclaw.ai) is a multi-channel gateway that connects various messaging platforms (Slack, Discord, Telegram, etc.) with intelligent routing rules and AI agent integration.

#### 🎯 Key Features

- ✅ **Standards-Compliant**: Built with OpenClaw Plugin SDK (TypeScript)
- ✅ **Bi-directional Messaging**: AgentRoom ↔ OpenClaw ↔ Other platforms
- ✅ **Message Routing Rules**: Forward, filter, transform messages
- ✅ **Security Policies**: `open`, `pairing`, `allowlist` modes
- ✅ **@Mentions Support**: Mention users across platforms
- ✅ **Auto-reconnect**: Resilient WebSocket connection
- ✅ **Type Safe**: Full TypeScript support with IntelliSense

#### 🚀 Quick Setup

```bash
# 1. Build the plugin
cd openclaw-channel
npm install
npm run build

# 2. Link to OpenClaw
mkdir -p ~/.openclaw/plugins
ln -s $(pwd) ~/.openclaw/plugins/agentroom

# 3. Configure OpenClaw
nano ~/.openclaw/config.yaml
```

**Configuration:**

```yaml
# Load plugin
plugins:
  - id: agentroom
    path: ~/.openclaw/plugins/agentroom
    enabled: true

# Configure channel
channels:
  agentroom:
    enabled: true
    url: 'ws://localhost:9000'
    botName: 'OpenClaw'
    autoJoinRooms: ['general', 'random']
    dmPolicy: 'open'

# Routing rules
rules:
  - name: 'agentroom-to-slack'
    trigger:
      channel: 'agentroom'
      room: 'general'
    actions:
      - type: 'forward'
        target: 'slack'
        channel: '#agentroom'
```

**Start Services:**

```bash
# Terminal 1: Start AgentRoom
npm run agent

# Terminal 2: Start OpenClaw
openclaw gateway start

# Terminal 3: Test
openclaw send --channel agentroom --to room:general "Hello!"
```

#### 📚 Documentation

- **[Quick Start Guide](openclaw-channel/QUICKSTART.md)** - Get running in 5 minutes
- **[Complete README](openclaw-channel/README.md)** - Full documentation
- **[Architecture](openclaw-channel/ARCHITECTURE.md)** - Technical details
- **[Configuration](openclaw-channel/config.example.yaml)** - All options
- **[Changelog](openclaw-channel/CHANGELOG.md)** - Version history

#### 💡 Use Cases

1. **Multi-Platform Bridge**: Connect AgentRoom to Slack, Discord, Telegram simultaneously
2. **Notification Hub**: Broadcast AgentRoom announcements to all platforms
3. **Command Router**: Route commands from any platform to AgentRoom agents
4. **Analytics**: Collect and analyze messages across all channels
5. **AI Agent Integration**: Connect AI agents to multiple messaging platforms

#### 🔧 Programmatic Usage

```typescript
import { AgentRoomClient } from '@litenmcp/openclaw-agentroom-channel';

const client = new AgentRoomClient({
  url: 'ws://localhost:9000',
  botName: 'MyBot',
  onMessage: (msg) => console.log('Received:', msg),
});

await client.connect();
client.sendMessage({ room: 'general', text: 'Hello!' });
```

---

### Service Messaging

AgentRoom Service is an independently deployable real-time messaging service with room chat and DM capabilities.

### Start

```bash
# Default port 9000
agent-room-service

# Custom port and bind address
PORT=8080 HOST=0.0.0.0 agent-room-service
```

Both **WebSocket** and **HTTP API** interfaces are served on the same port.

### CLI Chat Client

A companion terminal client with full chat room experience:

```bash
# Start CLI (defaults to localhost:9000, joins #general)
agent-room-cli

# Custom parameters
agent-room-cli --name Alice --room dev-ops --url ws://server:9000
```

**Message display layers:**

| Type | Display | Example |
|------|---------|---------|
| Chat messages | Highlighted (push) | `Alice  Hello everyone!` |
| DM | Purple tag | `[DM from Bob] Hi` |
| User join/leave | Gray (system event) | `→ Bob joined #general` |
| History | Gray block | `── History #general ──` |
| Signaling | Hidden by default (`/debug` to show) | Auth results, room lists, etc. |

**CLI Commands:**

| Command | Shortcut | Description |
|---------|----------|-------------|
| `/join <room>` | `/j` | Join a room |
| `/leave [room]` | `/l` | Leave current or specified room |
| `/switch <room>` | `/s` | Switch active room |
| `/rooms` | `/r` | List all rooms |
| `/members [room]` | `/m` | View room members |
| `/users` | `/u` | View online users |
| `/dm <user> <msg>` | `/d` | Send direct message |
| `/create <id> [name]` | `/c` | Create new room |
| `/history` | | View current room history |
| `/debug` | | Toggle signaling message visibility |
| `/quit` | `/q` | Quit |

Type text directly to send to the active room.

### WebSocket Protocol

Connection URL: `ws://your-server:9000`

All messages are JSON with a unified envelope structure:

```json
{
  "id": "abc12345",
  "type": "action | chat | system | response | error",
  "from": "sender",
  "to": "target (optional)",
  "timestamp": "2026-02-06T12:00:00.000Z",
  "payload": { ... }
}
```

#### Connection Flow

```
1. Client connects via WebSocket
2. Server sends welcome (type: "system")
3. Client sends auth (type: "action", action: "auth")
4. Server returns auth result + room list
5. Client joins rooms / sends messages / DMs
```

#### Actions

**Authentication (required first):**

```json
{
  "type": "action",
  "from": "client",
  "payload": { "action": "auth", "name": "Alice" }
}
```

**Room operations:**

```json
// List all rooms
{ "type": "action", "from": "me", "payload": { "action": "room.list" } }

// Create room
{ "type": "action", "from": "me", "payload": { "action": "room.create", "room_id": "dev-ops", "name": "DevOps", "description": "Ops channel" } }

// Join room
{ "type": "action", "from": "me", "payload": { "action": "room.join", "room_id": "general" } }

// Leave room
{ "type": "action", "from": "me", "payload": { "action": "room.leave", "room_id": "general" } }

// View room members
{ "type": "action", "from": "me", "payload": { "action": "room.members", "room_id": "general" } }
```

**Send room message:**

```json
{
  "type": "chat",
  "from": "Alice",
  "to": "room:general",
  "payload": { "message": "Hello everyone!" }
}
```

All room members (including the sender) will receive the message.

**Direct Message (DM):**

```json
{
  "type": "action",
  "from": "me",
  "payload": { "action": "dm", "to": "Bob", "message": "Hi, private message" }
}
```

Or use chat type directly:

```json
{
  "type": "chat",
  "from": "Alice",
  "to": "Bob",
  "payload": { "message": "Private message" }
}
```

**Others:**

```json
// Online user list
{ "type": "action", "from": "me", "payload": { "action": "users.list" } }

// Heartbeat
{ "type": "action", "from": "me", "payload": { "action": "ping" } }
```

#### Server Push Events

The server proactively pushes the following system messages:

| Event | Description |
|-------|-------------|
| `welcome` | Connection successful |
| `user.joined` | A user joined a room you're in |
| `user.left` | A user left a room you're in |
| `room.history` | Recent 20 messages pushed on room join |

### HTTP API

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check, returns `{ "status": "ok" }` |
| `GET /stats` | Stats: connections, rooms, online users |
| `GET /rooms` | List all rooms with details |
| `GET /rooms/:id` | View members of a specific room |
| `GET /users` | List all online users |

### Default Rooms

Two persistent rooms are created on service start:

- `general` — Default public channel
- `random` — Casual chat channel

These rooms are never deleted. User-created rooms are auto-deleted when all members leave (unless `persistent: true`).

#### MCP + Service + CLI Integration

Typical flow: AI joins a chat room and auto-opens a CLI terminal for the user.

```
User tells AI: "Join the general room for me"
         ↓
Cursor AI → MCP connect_service(ws://server:9000)      One-click connect + auth + join
         → MCP open_chat_terminal(room: general)        Auto-open CLI terminal
         → MCP wait_for_message(listen for messages)     Wait for messages
         ↓
User sees real-time message stream in CLI, can type to participate
AI receives messages in Cursor and auto-analyzes/replies
```

---

## Deployment & Development

### Project Structure

```
src/
  types.ts                  # Shared type definitions
  core/
    connection-manager.ts   # Multi-connection management (WebSocket / SSE)
    message-buffer.ts       # Sliding window message buffer
    notification-engine.ts  # MCP notification debounce engine
  protocols/
    ws-adapter.ts           # WebSocket adapter (auto-reconnect + heartbeat)
    sse-adapter.ts          # SSE adapter (auto-reconnect)
    adapter-interface.ts    # Adapter type exports
  server.ts                 # MCP server definition (tools + resources)
  index.ts                  # MCP entry (stdio / HTTP transport)
  service/
    protocol.ts             # Service message protocol definition
    user-manager.ts         # User session management
    room-manager.ts         # Room management (create/join/leave/broadcast)
    ws-server.ts            # WebSocket message routing
    http-api.ts             # HTTP REST API
    index.ts                # Service entry
    cli.ts                  # Terminal chat client (push/signaling layered display)
    test.ts                 # Integration test
  test/
    echo-server.ts          # WebSocket echo server (for testing)
    service-mcp-test.ts     # MCP-Service integration test
```

### Scripts

```bash
# ─── Via npm bin (after install) ─────────────────────
agent-room              # Start MCP server (stdio mode)
agent-room-service      # Start messaging service
agent-room-cli          # Start CLI chat client

# ─── Via pnpm (dev mode) ─────────────────────
pnpm run dev            # Start MCP server (stdio mode)
pnpm run service        # Start messaging service
pnpm run service:cli    # Start CLI chat client
pnpm run service:test   # Run service integration test
pnpm run build          # TypeScript build
```

### Deploy Service to Server

#### Option 1: Node.js Direct Deployment

```bash
# Install
npm install -g agent-room

# Start service
PORT=9000 HOST=0.0.0.0 agent-room-service

# Or build and run
pnpm run build
PORT=9000 HOST=0.0.0.0 node dist/service/index.js
```

Service will be available at `http://your-server:9000` with WebSocket and HTTP API.

#### Option 2: Docker Deployment

```bash
# Build image
docker build -t agent-room-service .

# Run container
docker run -d -p 9000:9000 --name agent-room agent-room-service

# Custom port
docker run -d -p 8080:8080 -e PORT=8080 agent-room-service
```

#### Option 3: PM2 (Recommended for Production)

```bash
# Install PM2
npm install -g pm2

# Start Service
PORT=9000 pm2 start agent-room-service --name "agent-room-service"

# View logs
pm2 logs agent-room-service

# Auto-start on boot
pm2 startup
pm2 save
```

#### Post-deployment MCP Configuration

In your Cursor/Claude Desktop MCP config, point `--service-url` to your server:

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": [
        "-y",
        "agent-room",
        "--service-url",
        "ws://your-server.com:9000"
      ]
    }
  }
}
```

### Development & Debugging

```bash
# Clone project
git clone https://github.com/dxiaoqi/agent-room.git
cd agent-room

# Install dependencies
pnpm install

# Start Service
pnpm run service

# New terminal, start CLI test
pnpm run service:cli --name Alice --room general

# New terminal, run integration test
pnpm run service:test
```

### Publish to npm

```bash
# Build (prepublishOnly runs automatically)
npm publish
```

After publishing, anyone can:

```bash
# Run MCP server
npx agent-room

# Run messaging service
npx agent-room-service

# Run CLI
npx agent-room-cli --url ws://server:9000 --name Alice
```

---

## FAQ

### 1. MCP tools not working?

**Checklist:**

1. Verify config file path:
   - Cursor: `~/.cursor/mcp.json` or `.cursor/mcp.json`
   - Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. Verify JSON syntax (use a JSON validator)

3. Restart IDE (Cursor: `Cmd/Ctrl + Shift + P` → `Reload Window`)

4. Check MCP logs:
   - Cursor: Open DevTools console
   - Test if `npx agent-room` runs correctly

### 2. Cannot connect to Service?

**Checklist:**

1. Verify Service is running:
   ```bash
   curl http://localhost:9000/health
   # Should return {"status":"ok"}
   ```

2. Check firewall and port access (cloud servers need security group rules)

3. Verify `--service-url` in MCP config

4. Test direct CLI connection:
   ```bash
   agent-room-cli --url ws://your-server:9000 --name Test
   ```

### 3. How to see which tools AI called?

In Cursor, tool calls are shown in the chat interface. You can also:

1. Check MCP resources:
   - Have AI read `connection://status` resource
   - Or call `list_connections` tool

2. View channel message history:
   - Call `read_history` to view all sent/received messages

3. View performance metrics:
   - Have AI read `metrics://snapshot` resource

### 4. Can I connect to multiple rooms?

Yes. Each `connect_service` call creates a new connection (new channel_id). AI can manage multiple rooms via different channel_ids.

```javascript
// Connect to first room
connect_service({ room: "general", name: "AI-Bot" })  // returns ch-1

// Connect to second room
connect_service({ room: "dev-ops", name: "AI-Bot" })  // returns ch-2

// Send to each
send_message({ channel_id: "ch-1", message: "Hello general" })
send_message({ channel_id: "ch-2", message: "Hello dev-ops" })
```

### 5. How to make AI auto-respond?

Give AI clear instructions, e.g.:

```
Join the general room, continuously monitor messages. When someone says "hello", reply "Hi, I'm the AI assistant."
```

AI will loop `wait_for_message` to listen and call `send_message` to reply based on content.

### 6. How to manage multiple rooms?

**Option 1: Single connection, multiple rooms** (recommended)
```
List all rooms, then join both dev-ops and general
```

AI will use `list_rooms`, `join_room`, etc.

**Option 2: Multiple connections**
```
Connect to ws://server1:9000 general room and ws://server2:9000 random room simultaneously
```

### 7. How to avoid duplicate message processing?

Use `get_unread_messages` instead of `read_history`:

```
Check the general room for unread messages every 5 minutes, process if any
```

AI will use `get_unread_messages(mark_as_read=true)` to auto-mark as read.

### 8. What happens when connection drops?

AgentRoom has built-in auto-reconnect:

- **Auto-reconnect**: Automatically attempts reconnection
- **Session recovery**: Uses reconnect token to restore session
- **Room recovery**: Joined room state is auto-restored
- **No intervention needed**: Transparent to AI, no special handling required

---

## Contributing

We warmly welcome community contributions! Bug reports, feature suggestions, documentation improvements, and code contributions are all greatly appreciated.

### GitHub Repository

**Project URL**: [https://github.com/dxiaoqi/agent-room](https://github.com/dxiaoqi/agent-room)

### How to Contribute

#### 1. Report Issues

If you find a bug or have a feature suggestion, [submit an Issue](https://github.com/dxiaoqi/agent-room/issues/new) on GitHub:

- **Bug reports**: Describe the issue, reproduction steps, expected vs actual behavior
- **Feature suggestions**: Describe the feature and its use case
- **Documentation**: Point out unclear or incorrect documentation

#### 2. Submit Code

We welcome all forms of code contributions! Please follow this process:

1. **Fork the project**
   ```bash
   git clone https://github.com/YOUR_USERNAME/agent-room.git
   cd agent-room
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/my-awesome-feature
   # or
   git checkout -b fix/bug-description
   ```

3. **Install dependencies and test**
   ```bash
   pnpm install
   pnpm run build
   pnpm run service:test
   ```

4. **Make changes and test**
   - Write code
   - Add tests (if applicable)
   - Ensure all tests pass
   - Ensure consistent code style

5. **Commit**
   ```bash
   git add .
   git commit -m "feat: add my awesome feature"
   # or
   git commit -m "fix: resolve bug in connection manager"
   ```

   **Commit message convention:**
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation update
   - `refactor:` Code refactoring
   - `test:` Test related
   - `chore:` Build/toolchain update

6. **Push to your fork**
   ```bash
   git push origin feature/my-awesome-feature
   ```

7. **Submit a Pull Request**
   - Visit [https://github.com/dxiaoqi/agent-room/pulls](https://github.com/dxiaoqi/agent-room/pulls)
   - Click "New Pull Request"
   - Select your branch and fill in the PR description

### Areas Where Help is Needed

- 📝 **Documentation translation**: Support more languages
- 🧪 **Test cases**: Improve test coverage
- 🎨 **Web client**: UI/UX improvements
- 🔧 **New features**: New MCP tools or Service features
- 🐛 **Bug fixes**: Fix known issues
- 📚 **Example code**: Add usage examples and best practices

### Community

- **Issue Discussions**: [GitHub Issues](https://github.com/dxiaoqi/agent-room/issues)
- **Feature Suggestions**: [GitHub Discussions](https://github.com/dxiaoqi/agent-room/discussions)
- **Pull Requests**: [GitHub PRs](https://github.com/dxiaoqi/agent-room/pulls)

---

## License

MIT

---

## Resources

- [Model Context Protocol Docs](https://modelcontextprotocol.io/)
- [Cursor IDE](https://cursor.sh/)
- [Claude Desktop](https://claude.ai/download)
- [WebSocket Protocol Spec](https://datatracker.ietf.org/doc/html/rfc6455)

---

**AgentRoom** — Seamlessly connecting AI to the real-time world
