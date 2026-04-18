import { fileURLToPath } from 'url'
import path from 'path'
import { readEnvFile } from './env.js'

export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const STORE_DIR = path.join(PROJECT_ROOT, 'store')

const env = readEnvFile()

// Bridge ANTHROPIC_API_KEY from .env to process.env for Claude Code SDK
if (!process.env.ANTHROPIC_API_KEY && env['ANTHROPIC_API_KEY']) {
  process.env.ANTHROPIC_API_KEY = env['ANTHROPIC_API_KEY']
}

// Bridge OPENAI_API_KEY from .env to process.env for spawned Codex CLI
if (!process.env.OPENAI_API_KEY && env['OPENAI_API_KEY']) {
  process.env.OPENAI_API_KEY = env['OPENAI_API_KEY']
}

// Bridge BACKEND_PROVIDER from .env to process.env; normalize and fall back to 'claude'
{
  const raw = (process.env.BACKEND_PROVIDER ?? env['BACKEND_PROVIDER'] ?? '').toLowerCase()
  const normalized = raw === 'claude' || raw === 'codex' ? raw : 'claude'
  process.env.BACKEND_PROVIDER = normalized
}

// Bridge CODEX_MODEL from .env to process.env (only when set)
if (!process.env.CODEX_MODEL && env['CODEX_MODEL']) {
  process.env.CODEX_MODEL = env['CODEX_MODEL']
}

export const TELEGRAM_BOT_TOKEN = env['TELEGRAM_BOT_TOKEN'] ?? ''
export const ALLOWED_CHAT_ID = env['ALLOWED_CHAT_ID'] ?? ''
export const GROQ_API_KEY = env['GROQ_API_KEY'] ?? ''
export const GOOGLE_API_KEY = env['GOOGLE_API_KEY'] ?? ''
export const ASSISTANT_NAME = env['ASSISTANT_NAME'] ?? process.env.ASSISTANT_NAME ?? 'Assistant'
export const USER_NAME = env['USER_NAME'] ?? process.env.USER_NAME ?? 'User'

export const BACKEND_PROVIDER: 'claude' | 'codex' =
  process.env.BACKEND_PROVIDER === 'codex' ? 'codex' : 'claude'
export const OPENAI_API_KEY = env['OPENAI_API_KEY'] ?? process.env.OPENAI_API_KEY ?? ''
export const CODEX_MODEL = env['CODEX_MODEL'] ?? process.env.CODEX_MODEL ?? ''

export const MAX_MESSAGE_LENGTH = 4096
export const TYPING_REFRESH_MS = 4000
