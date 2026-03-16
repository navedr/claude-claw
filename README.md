# ClaudeClaw

A Telegram bot that proxies messages to [Claude Code](https://claude.ai/code), giving you a personal AI assistant accessible from anywhere. Send text, voice, images, or files -- ClaudeClaw handles it all through Claude's agentic capabilities.

## Quick Start (Docker)

```bash
# 1. Pull the image
docker pull ghcr.io/navedr/claude-claw:latest

# 2. Create your config
curl -O https://raw.githubusercontent.com/navedr/claude-claw/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/navedr/claude-claw/main/.env.example
cp .env.example .env

# 3. Configure (edit .env with your tokens)
#    - Get TELEGRAM_BOT_TOKEN from @BotFather
#    - Set ANTHROPIC_API_KEY or use CLI login (see Auth below)

# 4. Start
docker compose up -d

# 5. Get your chat ID
#    Send /chatid to your bot in Telegram, then add it to .env as ALLOWED_CHAT_ID
#    Restart: docker compose restart
```

## Authentication

Two ways to authenticate with Claude:

### Option 1: API Key (simplest)

Set `ANTHROPIC_API_KEY` in your `.env` file. Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys).

### Option 2: CLI Login (no API key needed)

```bash
docker compose run --rm claudeclaw login
```

A URL will appear -- open it in your browser to complete OAuth. Credentials persist in the `./auth/` directory across restarts.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `ALLOWED_CHAT_ID` | Yes | Your Telegram chat ID (send `/chatid` to bot) |
| `ANTHROPIC_API_KEY` | One of | API key for Claude |
| CLI login | these | OAuth via `docker compose run --rm claudeclaw login` |
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
Telegram <-> grammy bot <-> Claude Code SDK <-> Claude API
                |                  |
                v                  v
           Dashboard (3847)   Sub-agents (parallel tasks)
                |
                v
           SQLite (store/)
```

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
