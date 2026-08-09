# ClaudeClaw

A Docker-first AI assistant you can reach from Telegram, [claude.ai/code](https://claude.ai/code), or the Claude mobile app. Pick your backend -- Claude Code or OpenAI Codex -- and mix in Remote Control for web/mobile access. All three can run simultaneously in a single container.

## What it does

| Surface | Backend | How it works |
|---------|---------|--------------|
| **Telegram bot** | Claude Code SDK or Codex SDK | Send text, voice, images, files, or video and get agentic responses |
| **Remote Control** | Claude Code CLI | Drive a full Claude Code session from claude.ai/code or the Claude app on your phone |
| **Dashboard** | -- | Live job monitoring, token usage, and history at `http://localhost:3847` |

You can run the Telegram bot on Codex while simultaneously running Remote Control on Claude -- they're independent processes in the same container.

## Quick Start

### 1. Download config files

```bash
curl -O https://raw.githubusercontent.com/navedr/claude-claw/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/navedr/claude-claw/main/.env.example
cp .env.example .env
```

### 2. Set up Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram to create a bot
2. Copy the bot token into `.env` as `TELEGRAM_BOT_TOKEN`

### 3. Authenticate

Pick your backend and authenticate:

**Claude (default)**

Set `ANTHROPIC_API_KEY` in `.env`, or run the OAuth login flow:

```bash
mkdir -p auth && touch auth/.claude.json
docker compose run --rm claude-claw login
```

**Codex**

Set `BACKEND_PROVIDER=codex` and `OPENAI_API_KEY` in `.env`. For Azure, set `CODEX_PROVIDER=azure` with `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY`.

### 4. Get your chat ID

```bash
docker compose up -d
```

Send `/chatid` to your bot in Telegram. Add the ID to `.env` as `ALLOWED_CHAT_ID`, then restart:

```bash
docker compose restart
```

## Remote Control

Run a full Claude Code session accessible from [claude.ai/code](https://claude.ai/code) or the Claude mobile app. Runs alongside the Telegram bot in the same container -- your local filesystem, MCP servers, and project config all stay available.

**Requires OAuth login** (API keys are not supported):

```bash
mkdir -p auth && touch auth/.claude.json
docker compose run --rm claude-claw login
```

Enable in `.env`:

```
ENABLE_RC=1
RC_SESSION_NAME=ClaudeClaw
```

Restart the container and your session will appear in [claude.ai/code](https://claude.ai/code).

> Remote Control works independently of `BACKEND_PROVIDER`. You can run the Telegram bot on Codex (`BACKEND_PROVIDER=codex`) and Remote Control on Claude simultaneously.

## T3 Code Control Plane

T3 Code runs in the same container as Telegram and uses the same persisted `~/.codex` directory. Each Telegram chat keeps one durable Codex thread; `/newchat` or `/newsession` starts a replacement thread. That thread is visible in T3, where you can inspect, resume, and manage it alongside sessions created directly in T3.

Enable it in `.env`:

```
ENABLE_T3=1
```

Compose exposes T3 on `127.0.0.1:3773` only. Forward it from your workstation with `ssh -L 3773:127.0.0.1:3773 butler`, or configure Tailscale Serve on the Butler host to proxy its loopback port. Use `docker compose exec claude-claw t3 pair` to create a pairing token after the server is running. Treat pairing links and tokens as credentials.

Telegram serializes messages per chat. Do not submit work from Telegram and T3 to the same Codex thread at the same time; T3 is the full control plane for manually coordinating that shared session.
## Backends

### Claude (default)

`BACKEND_PROVIDER=claude` -- uses the [Claude Code SDK](https://docs.anthropic.com/en/docs/claude-code). Auth via `ANTHROPIC_API_KEY` or the `login` subcommand.

### Codex

`BACKEND_PROVIDER=codex` -- uses the [OpenAI Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), backed by the installed Codex CLI. Two providers:

- `CODEX_PROVIDER=openai` (default) -- requires `OPENAI_API_KEY`
- `CODEX_PROVIDER=azure` -- requires `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY`. Config is auto-provisioned at boot.

Set `CODEX_MODEL` to pick a specific model/deployment; leave blank for the Codex default.

#### Skills bridging

Codex doesn't natively support Claude's skills system. ClaudeClaw bridges them by regenerating `/app/AGENTS.md` before every Codex turn, concatenating `CLAUDE.md` and all `*.md` files from `~/.claude/skills/`. Drop a new skill file into the mounted skills directory and it's picked up on the next message.

## Configuration

### Core

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `ALLOWED_CHAT_ID` | Yes | Your Telegram chat ID (send `/chatid` to bot) |
| `BACKEND_PROVIDER` | No | `claude` (default) or `codex` |
| `ASSISTANT_NAME` | No | Bot's name (default: `Assistant`) |
| `USER_NAME` | No | Your name (default: `User`) |

### Claude backend

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | One of | API key (or use `login` for OAuth) |

### Codex backend

| Variable | Required | Description |
|----------|----------|-------------|
| `CODEX_PROVIDER` | No | `openai` (default) or `azure` |
| `OPENAI_API_KEY` | openai | API key for OpenAI |
| `AZURE_OPENAI_ENDPOINT` | azure | Azure resource URL |
| `AZURE_OPENAI_API_KEY` | azure | API key from Azure |
| `CODEX_MODEL` | No | Model/deployment name (blank = default) |

### Remote Control

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_RC` | `0` | Set to `1` to enable |
| `RC_SESSION_NAME` | `ClaudeClaw` | Session title in claude.ai |
| `RC_PERMISSION_MODE` | *(default)* | `default`, `acceptEdits`, `bypassPermissions`, `dontAsk`, `plan` |
| `RC_SPAWN_MODE` | `same-dir` | `same-dir`, `worktree`, or `session` |
| `RC_CAPACITY` | `32` | Max concurrent sessions |
| `RC_VERBOSE` | `0` | `1` for detailed logs |
| `RC_SANDBOX` | *(default)* | `1` for `--sandbox`, `0` for `--no-sandbox` |

### Media & extras

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Voice transcription via Groq Whisper |
| `GOOGLE_API_KEY` | Video analysis via Gemini |

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize the bot |
| `/chatid` | Get your Telegram chat ID |
| `/status` | View running jobs and usage stats |
| `/newsession` | Start a fresh session |
| `/cancel` | Cancel the current operation |

## Features

- **Text** -- send any message, get an agentic response
- **Voice** -- voice messages auto-transcribed via Groq Whisper
- **Images** -- photos analyzed via vision
- **Files** -- documents read and processed by the agent
- **Video** -- video files analyzed via Gemini
- **Multi-agent** -- complex tasks spawn parallel sub-agents with live dashboard
- **Session persistence** -- conversations maintain context across messages
- **Scheduled tasks** -- recurring prompts via cron
- **Remote Control** -- access from claude.ai/code or Claude mobile app

## Architecture

```
                                ┌─────────────────────────┐
                                │      Docker container    │
                                │                          │
Telegram ◄──► grammy bot ◄──► Agent backend               │
                 │              ├─ Claude Code SDK          │
                 │              └─ Codex SDK                │
                 │                                         │
                 ├──► Dashboard (port 3847)                │
                 ├──► T3 Code (private port 3773)          │
                 ├──► SQLite (store/)                      │
                 └──► Sub-agents (parallel tasks)          │
                                                           │
claude.ai/code ◄──► Claude RC (remote-control)            │
Claude app         (outbound HTTPS, no inbound ports)      │
                                └─────────────────────────┘
```

The Telegram bot, Remote Control, and optional T3 Code sidecar are supervised by the entrypoint script. `init: true` in docker-compose ensures clean signal forwarding to both on container stop.

## Customization

Mount a custom `CLAUDE.md` to define your assistant's personality:

```yaml
volumes:
  - ./my-custom-claude.md:/app/CLAUDE.md:ro
```

Or set `ASSISTANT_NAME` and `USER_NAME` env vars to auto-generate from the built-in template.

See `CLAUDE.md.example` for an advanced configuration reference.

## Local Development

```bash
git clone https://github.com/navedr/claude-claw.git
cd claude-claw
npm install
cp .env.example .env
# Edit .env with your tokens
npm run dev
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode (tsx) |
| `npm start` | Start production build |
| `npm run build` | Compile TypeScript |
| `npm run setup` | Interactive setup wizard |
| `npm test` | Run tests |

## License

MIT
