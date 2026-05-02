#!/usr/bin/env bash
set -e

CLAUDE_CLI="node /app/node_modules/@anthropic-ai/claude-code/cli.js"
CODEX_CLI="node /app/node_modules/@openai/codex/bin/codex.js"
BACKEND_PROVIDER="${BACKEND_PROVIDER:-claude}"
CODEX_PROVIDER="${CODEX_PROVIDER:-openai}"

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
  mkdir -p "$HOME/.codex"
  CODEX_CONFIG="$HOME/.codex/config.toml"

  if [ "$CODEX_PROVIDER" = "azure" ]; then
    # Azure OpenAI: require endpoint + API key
    if [ -z "$AZURE_OPENAI_API_KEY" ]; then
      echo "ERROR: AZURE_OPENAI_API_KEY is required when CODEX_PROVIDER=azure."
      echo "Set it in your .env file."
      exit 1
    fi
    if [ -z "$AZURE_OPENAI_ENDPOINT" ]; then
      echo "ERROR: AZURE_OPENAI_ENDPOINT is required when CODEX_PROVIDER=azure."
      echo "Example: https://your-resource.openai.azure.com"
      exit 1
    fi

    # Strip trailing slash from endpoint
    ENDPOINT="${AZURE_OPENAI_ENDPOINT%/}"

    # Write config.toml only if provider/endpoint/model changed
    EXPECTED_BASE="${ENDPOINT}/openai/v1"
    EXPECTED_MODEL="${CODEX_MODEL:-gpt-5-codex}"
    NEEDS_UPDATE=0
    if [ ! -f "$CODEX_CONFIG" ]; then
      NEEDS_UPDATE=1
    elif ! grep -q "model_provider = \"azure\"" "$CODEX_CONFIG" 2>/dev/null; then
      NEEDS_UPDATE=1
    elif ! grep -q "$EXPECTED_BASE" "$CODEX_CONFIG" 2>/dev/null; then
      NEEDS_UPDATE=1
    elif ! grep -q "^model = \"$EXPECTED_MODEL\"" "$CODEX_CONFIG" 2>/dev/null; then
      NEEDS_UPDATE=1
    fi

    if [ "$NEEDS_UPDATE" = "1" ]; then
      echo "Provisioning codex config.toml for Azure..."
      cat > "$CODEX_CONFIG" <<TOML
model = "${CODEX_MODEL:-gpt-5-codex}"
model_provider = "azure"
model_reasoning_effort = "medium"

[model_providers.azure]
name = "Azure OpenAI"
base_url = "${ENDPOINT}/openai/v1"
env_key = "AZURE_OPENAI_API_KEY"
wire_api = "responses"

[projects."/app"]
trust_level = "trusted"
TOML
    fi

  else
    # OpenAI direct: reset config.toml if it had azure settings from a previous run
    if grep -q 'model_provider = "azure"' "$CODEX_CONFIG" 2>/dev/null; then
      echo "Resetting codex config.toml for OpenAI..."
      cat > "$CODEX_CONFIG" <<TOML
[projects."/app"]
trust_level = "trusted"
TOML
    fi

    # Require API key
    if [ -z "$OPENAI_API_KEY" ]; then
      echo ""
      echo "ERROR: OPENAI_API_KEY is required when BACKEND_PROVIDER=codex."
      echo ""
      echo "Set OPENAI_API_KEY in your .env file."
      echo "Get a key at https://platform.openai.com/api-keys"
      echo ""
      exit 1
    fi

    # Provision ~/.codex/auth.json from OPENAI_API_KEY
    CODEX_AUTH="$HOME/.codex/auth.json"
    if [ ! -f "$CODEX_AUTH" ] || ! grep -q "$OPENAI_API_KEY" "$CODEX_AUTH" 2>/dev/null; then
      echo "Provisioning codex auth.json from OPENAI_API_KEY..."
      printf '%s' "$OPENAI_API_KEY" | $CODEX_CLI login --with-api-key >/dev/null
    fi
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
