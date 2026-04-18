# ClaudeClaw

A Telegram bot that proxies messages to [Claude Code](https://claude.ai/code), giving you a personal AI assistant accessible from anywhere. Send text, voice, images, or files -- ClaudeClaw handles it all through Claude's agentic capabilities.

## Quick Start (Docker)

### 1. Download config files

```bash
curl -O https://raw.githubusercontent.com/navedr/claude-claw/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/navedr/claude-claw/main/.env.example
cp .env.example .env
```

### 2. Set up Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram to create a bot
2. Copy the bot token into `.env` as `TELEGRAM_BOT_TOKEN`

### 3. Authenticate with Claude

**Option A: API Key (simplest)**

Set `ANTHROPIC_API_KEY` in your `.env` file. Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys).

**Option B: CLI Login (no API key needed)**

```bash
mkdir -p auth && touch auth/.claude.json
docker compose run --rm claude-claw login
```

A URL will appear -- open it in your browser to complete OAuth. Credentials persist in `./auth/` across restarts.

### 4. Get your chat ID

```bash
docker compose up -d
```

Send `/chatid` to your bot in Telegram. Add the ID to `.env` as `ALLOWED_CHAT_ID`, then restart:

```bash
docker compose restart
```

Your bot is now ready to use.

## Backends

ClaudeClaw supports two backends, selected via `BACKEND_PROVIDER`:

- `claude` (default) -- uses [Claude Code](https://claude.ai/code). Auth via `ANTHROPIC_API_KEY` or the `login` subcommand.
- `codex` -- uses [OpenAI Codex CLI](https://github.com/openai/codex). Requires `OPENAI_API_KEY`. No `login` flow -- API key only. Set `CODEX_MODEL` to pick a specific model (e.g. `gpt-5-codex`); leave blank for the CLI default.

### Skills (Codex)

Codex doesn't natively support Claude's skills system, so ClaudeClaw bridges them via `AGENTS.md`. Before every Codex turn, the bot regenerates `/app/AGENTS.md` by concatenating:

1. `CLAUDE.md` (personality)
2. Every `*.md` file in `~/.claude/skills/` inside the container

Codex auto-loads `AGENTS.md` from cwd, so your existing Claude skills work unchanged. Drop a new skill file into the mounted skills directory and it's picked up on the next message -- no restart.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `ALLOWED_CHAT_ID` | Yes | Your Telegram chat ID (send `/chatid` to bot) |
| `BACKEND_PROVIDER` | No | `claude` (default) or `codex` |
| `ANTHROPIC_API_KEY` | Claude | API key for Claude (or use `login` subcommand) |
| `OPENAI_API_KEY` | Codex | API key for OpenAI Codex |
| `CODEX_MODEL` | No | Codex model override (blank = CLI default) |
| `ASSISTANT_NAME` | No | Bot's name (default: `Assistant`) |
| `USER_NAME` | No | Your name (default: `User`) |
| `GROQ_API_KEY` | No | Voice transcription via Groq Whisper |
| `GOOGLE_API_KEY` | No | Video analysis via Gemini |

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize the bot |
| `/chatid` | Get your Telegram chat ID |
| `/status` | View running jobs and usage stats |
| `/newsession` | Start a fresh Claude session |
| `/cancel` | Cancel the current operation |

## Features

- **Text** -- send any message, get Claude's response
- **Voice** -- send voice messages, auto-transcribed via Groq Whisper
- **Images** -- send photos for visual analysis
- **Files** -- send documents for Claude to read and process
- **Video** -- send video files for analysis via Gemini
- **Multi-agent** -- complex tasks spawn parallel sub-agents with a live dashboard
- **Session persistence** -- conversations maintain context across messages
- **Scheduled tasks** -- set up recurring prompts via cron

## Dashboard

A live mission control dashboard runs at `http://localhost:3847` showing:
- Running jobs and sub-agents
- Token usage statistics
- Job history

## Local Development

```bash
git clone https://github.com/navedr/claude-claw.git
cd claude-claw
npm install
cp .env.example .env
# Edit .env with your tokens
npm run dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode (tsx) |
| `npm start` | Start production build |
| `npm run build` | Compile TypeScript |
| `npm run setup` | Interactive setup wizard |
| `npm test` | Run tests |

## Architecture

```
Telegram <-> grammy bot <-> Agent backend <-> Claude Code SDK / Codex CLI
                |                  |
                v                  v
           Dashboard (3847)   Sub-agents (parallel tasks)
                |
                v
           SQLite (store/)
```

Backend is selected at startup via `BACKEND_PROVIDER`. Both SDKs ship in the image.

## Customization

Mount a custom `CLAUDE.md` to define your assistant's personality:

```yaml
volumes:
  - ./my-custom-claude.md:/app/CLAUDE.md:ro
```

Or set `ASSISTANT_NAME` and `USER_NAME` env vars to auto-generate from the built-in template.

See `CLAUDE.md.example` for an advanced configuration reference.

## License

MIT
