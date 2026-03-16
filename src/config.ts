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

export const TELEGRAM_BOT_TOKEN = env['TELEGRAM_BOT_TOKEN'] ?? ''
export const ALLOWED_CHAT_ID = env['ALLOWED_CHAT_ID'] ?? ''
export const GROQ_API_KEY = env['GROQ_API_KEY'] ?? ''
export const GOOGLE_API_KEY = env['GOOGLE_API_KEY'] ?? ''
export const ASSISTANT_NAME = env['ASSISTANT_NAME'] ?? process.env.ASSISTANT_NAME ?? 'Assistant'
export const USER_NAME = env['USER_NAME'] ?? process.env.USER_NAME ?? 'User'

export const MAX_MESSAGE_LENGTH = 4096
export const TYPING_REFRESH_MS = 4000
