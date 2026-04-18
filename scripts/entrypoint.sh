#!/usr/bin/env bash
set -e

CLAUDE_CLI="node /app/node_modules/@anthropic-ai/claude-code/cli.js"
BACKEND_PROVIDER="${BACKEND_PROVIDER:-claude}"

# ── Login mode ──
# Usage: docker compose run --rm claudeclaw login
if [ "$1" = "login" ]; then
  if [ "$BACKEND_PROVIDER" = "codex" ]; then
    echo "ERROR: 'login' is only supported for the Claude backend."
    echo "Codex authenticates via OPENAI_API_KEY -- set it in your .env file."
    echo "Get a key at https://platform.openai.com/api-keys"
    exit 1
  fi
  echo "Starting Claude Code login..."
  echo "A URL will appear below. Open it in your browser to authenticate."
  echo ""
  exec $CLAUDE_CLI login
fi

# ── Generate CLAUDE.md from template if not present ──
if [ ! -f /app/CLAUDE.md ] || [ "$REGENERATE_CLAUDE_MD" = "1" ]; then
  sed -e "s/{{ASSISTANT_NAME}}/${ASSISTANT_NAME:-Assistant}/g" \
      -e "s/{{USER_NAME}}/${USER_NAME:-User}/g" \
      /app/CLAUDE.md.template > /app/CLAUDE.md
fi

# ── Create memory.md if missing ──
if [ ! -f /app/memory.md ]; then
  echo -e "# Persistent Memories\n_Semantic facts learned over time._" > /app/memory.md
fi

# ── Check auth ──
if [ "$BACKEND_PROVIDER" = "codex" ]; then
  if [ -z "$OPENAI_API_KEY" ]; then
    echo ""
    echo "ERROR: OPENAI_API_KEY is required when BACKEND_PROVIDER=codex."
    echo ""
    echo "Set OPENAI_API_KEY in your .env file."
    echo "Get a key at https://platform.openai.com/api-keys"
    echo ""
    exit 1
  fi
else
  if [ -z "$ANTHROPIC_API_KEY" ] && [ ! -f "$HOME/.claude.json" ] && [ ! -f "$HOME/.claude/credentials.json" ]; then
    echo ""
    echo "ERROR: No authentication found."
    echo ""
    echo "Option 1 (API key): Set ANTHROPIC_API_KEY in your .env file"
    echo "Option 2 (CLI login): Run 'docker compose run --rm claudeclaw login'"
    echo ""
    exit 1
  fi
fi

exec node dist/index.js "$@"
