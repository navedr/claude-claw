#!/usr/bin/env bash
set -e

CLAUDE_CLI="node /app/node_modules/@anthropic-ai/claude-code/cli.js"

# ── Login mode ──
# Usage: docker compose run --rm claudeclaw login
if [ "$1" = "login" ]; then
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
if [ -z "$ANTHROPIC_API_KEY" ] && [ ! -f "$HOME/.claude.json" ] && [ ! -f "$HOME/.claude/credentials.json" ]; then
  echo ""
  echo "ERROR: No authentication found."
  echo ""
  echo "Option 1 (API key): Set ANTHROPIC_API_KEY in your .env file"
  echo "Option 2 (CLI login): Run 'docker compose run --rm claudeclaw login'"
  echo ""
  exit 1
fi

exec node dist/index.js "$@"
