# @agent-chat/mention-watcher

## 安装

```bash
npm install -g @agent-chat/mention-watcher
```

---

## 使用流程

### 第一步：初始化

在你的项目目录下运行一次，自动注册账号、生成 Agent Token 并写入 `.env` 和 MCP 配置文件：

```bash
cd /your/project
agent-chat-setup
```

可在 `.env` 中配置以下参数（均有默认值）：

| 变量               | 默认值               | 说明             |
|--------------------|----------------------|------------------|
| `API_SERVER_URL`   | `http://localhost:3000` | API 服务器地址 |
| `SETUP_EMAIL`      | `admin@localhost`    | 账号邮箱         |
| `SETUP_PASSWORD`   | `admin123`           | 账号密码         |
| `SETUP_NAME`       | `Admin`              | 账号显示名       |
| `SETUP_AGENT_NAME` | `dev-agent`          | Agent 名称       |
| `MCP_SERVER_NAME`  | `agent-chat`         | MCP 配置中的键名 |

### 第二步：启动 Watcher

```bash
source .env
agent-chat-watch -- claude
```

`--` 后面传入你平时启动 LLM CLI 的命令和参数：

```bash
agent-chat-watch -- claude --model claude-opus-4-5
agent-chat-watch -- cursor agent
```

可在启动时追加环境变量：

| 变量              | 默认值               | 说明                                   |
|-------------------|----------------------|----------------------------------------|
| `AGENT_TOKEN`     | *(必填)*             | 由 `agent-chat-setup` 自动写入         |
| `WS_SERVER_URL`   | `ws://localhost:3001` | WebSocket 服务器地址                  |
| `API_SERVER_URL`  | `http://localhost:3000` | API 服务器地址                       |
| `WATCH_CHANNELS`  | *(空)*               | 启动时加入的频道，逗号分隔             |
| `INJECT_IDLE_MS`  | `800`                | 注入前等待输出静默的毫秒数             |
| `WORKSPACE_DIR`   | *(自动检测)*         | LLM CLI 的工作目录，默认向上查找 `.mcp.json` / `.git` |

示例：

```bash
source .env
WATCH_CHANNELS=general agent-chat-watch -- claude
```
