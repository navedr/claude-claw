import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import https from 'https'

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

const ok = (label: string, detail = '') => console.log(`${GREEN}✓${RESET} ${label}${detail ? ` — ${detail}` : ''}`)
const warn = (label: string, detail = '') => console.log(`${YELLOW}⚠${RESET} ${label}${detail ? ` — ${detail}` : ''}`)
const fail = (label: string, detail = '') => console.log(`${RED}✗${RESET} ${label}${detail ? ` — ${detail}` : ''}`)

async function checkTelegramToken(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    https.get(`https://api.telegram.org/bot${token}/getMe`, (res) => {
      let data = ''
      res.on('data', (c: string) => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data).ok === true) } catch { resolve(false) }
      })
    }).on('error', () => resolve(false))
  })
}

async function main() {
  console.log('\nClaudeClaw Status\n' + '─'.repeat(40))

  // Node version
  const [major] = process.versions.node.split('.').map(Number)
  if (major >= 20) ok(`Node.js ${process.versions.node}`)
  else fail(`Node.js ${process.versions.node}`, 'need >= 20')

  // Claude CLI
  try {
    const v = execSync('claude --version', { encoding: 'utf8' }).trim()
    ok(`Claude CLI`, v)
  } catch {
    fail('Claude CLI', 'not found')
  }

  // .env exists
  const envPath = path.join(PROJECT_ROOT, '.env')
  if (!existsSync(envPath)) {
    warn('.env file', 'not found — run npm run setup')
  } else {
    ok('.env file exists')
  }

  // Load env values
  let TELEGRAM_BOT_TOKEN = ''
  let ALLOWED_CHAT_ID = ''
  let GROQ_API_KEY = ''
  if (existsSync(envPath)) {
    const { readEnvFile } = await import('../src/env.js')
    const env = readEnvFile()
    TELEGRAM_BOT_TOKEN = env['TELEGRAM_BOT_TOKEN'] ?? ''
    ALLOWED_CHAT_ID = env['ALLOWED_CHAT_ID'] ?? ''
    GROQ_API_KEY = env['GROQ_API_KEY'] ?? ''
  }

  // Telegram token
  if (!TELEGRAM_BOT_TOKEN) {
    fail('Telegram bot token', 'not set')
  } else {
    const valid = await checkTelegramToken(TELEGRAM_BOT_TOKEN)
    if (valid) ok('Telegram bot token', 'valid')
    else fail('Telegram bot token', 'invalid (API rejected it)')
  }

  // Chat ID
  if (!ALLOWED_CHAT_ID) warn('Allowed chat ID', 'not set — send /chatid to bot')
  else ok(`Allowed chat ID`, ALLOWED_CHAT_ID)

  // Groq
  if (!GROQ_API_KEY) warn('Groq API key', 'not set — voice STT disabled')
  else ok('Groq API key', 'configured')

  // DB file
  const dbPath = path.join(PROJECT_ROOT, 'store', 'claudeclaw.db')
  if (existsSync(dbPath)) {
    ok('Database', dbPath)
  } else {
    warn('Database', 'not found — will be created on first run')
  }

  // Docker status
  try {
    const out = execSync('docker compose ps --format json', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim()
    if (out) {
      const containers = out.split('\n').map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      for (const c of containers) {
        if (c.State === 'running') ok(`Docker: ${c.Service}`, 'running')
        else warn(`Docker: ${c.Service}`, c.State)
      }
    } else {
      warn('Docker', 'no containers running')
    }
  } catch {
    warn('Docker', 'docker compose not available or not in project dir')
  }

  console.log()
}

main().catch(err => {
  console.error('Status check failed:', err)
  process.exit(1)
})
