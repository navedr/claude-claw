import { execSync, spawnSync } from 'child_process'
import { createInterface } from 'readline'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const ok = (msg: string) => console.log(`${GREEN}✓${RESET} ${msg}`)
const warn = (msg: string) => console.log(`${YELLOW}⚠${RESET} ${msg}`)
const fail = (msg: string) => console.log(`${RED}✗${RESET} ${msg}`)

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> =>
  new Promise(resolve => rl.question(q, resolve))

const BANNER = `
${BOLD} ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗${RESET}
${BOLD}██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝${RESET}
${BOLD}██║     ██║     ███████║██║   ██║██║  ██║█████╗  ${RESET}
${BOLD}██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝  ${RESET}
${BOLD}╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗${RESET}
${BOLD} ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝${RESET}

${BOLD}ClaudeClaw Setup Wizard${RESET}
`

async function main() {
  // Skip wizard inside Docker container
  if (existsSync('/.dockerenv')) {
    console.log('Running inside Docker -- skipping setup wizard.')
    console.log('Configure via environment variables in .env file.')
    process.exit(0)
  }

  console.log(BANNER)

  // ── Requirements check ─────────────────────────────────────────────────────
  console.log(`\n${BOLD}Checking requirements...${RESET}\n`)

  const nodeVer = process.versions.node
  const [major] = nodeVer.split('.').map(Number)
  if (major >= 20) {
    ok(`Node.js ${nodeVer}`)
  } else {
    fail(`Node.js ${nodeVer} — need >= 20`)
    process.exit(1)
  }

  try {
    const claudeVer = execSync('claude --version', { encoding: 'utf8' }).trim()
    ok(`Claude CLI: ${claudeVer}`)
  } catch {
    fail('Claude CLI not found. Install from: https://claude.ai/code')
    process.exit(1)
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Building project...${RESET}\n`)
  const buildResult = spawnSync('npm', ['run', 'build'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
  })
  if (buildResult.status !== 0) {
    fail('Build failed. Fix TypeScript errors above and re-run setup.')
    process.exit(1)
  }
  ok('Build successful')

  // ── Collect config ─────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Collecting configuration...${RESET}\n`)

  const botToken = await ask('Telegram bot token (from @BotFather): ')
  if (!botToken.trim()) {
    fail('Bot token is required.')
    process.exit(1)
  }

  const assistantName = await ask('Assistant name (default: Jarvis): ') || 'Jarvis'
  const userName = await ask('Your name: ')
  const apiKey = await ask('Anthropic API key (or press Enter to skip if using CLI login): ')

  const groqKey = await ask('Groq API key (free at console.groq.com, or press Enter to skip): ')
  const googleKey = await ask('Google API key for video analysis (free at aistudio.google.com, or press Enter to skip): ')

  // ── Write .env ─────────────────────────────────────────────────────────────
  const envLines = [
    `TELEGRAM_BOT_TOKEN=${botToken.trim()}`,
    `ALLOWED_CHAT_ID=`,
    `ASSISTANT_NAME=${assistantName.trim()}`,
    `USER_NAME=${userName.trim()}`,
    ...(apiKey.trim() ? [`ANTHROPIC_API_KEY=${apiKey.trim()}`] : []),
    `GROQ_API_KEY=${groqKey.trim()}`,
    `GOOGLE_API_KEY=${googleKey.trim()}`,
  ]
  const envPath = path.join(PROJECT_ROOT, '.env')
  writeFileSync(envPath, envLines.join('\n') + '\n', 'utf8')
  ok('.env written')

  // ── Generate CLAUDE.md from template ──────────────────────────────────────
  const templatePath = path.join(PROJECT_ROOT, 'CLAUDE.md.template')
  const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md')
  if (existsSync(templatePath)) {
    let template = readFileSync(templatePath, 'utf8')
    template = template.replace(/\{\{ASSISTANT_NAME\}\}/g, assistantName.trim() || 'Assistant')
    template = template.replace(/\{\{USER_NAME\}\}/g, userName.trim() || 'User')
    writeFileSync(claudeMdPath, template, 'utf8')
    ok('CLAUDE.md generated from template')
  } else {
    warn('CLAUDE.md.template not found -- edit CLAUDE.md manually')
  }

  // ── Get chat ID ────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Getting your Telegram chat ID...${RESET}\n`)
  console.log('1. Start the bot temporarily: npm run start')
  console.log('2. Send /chatid to your bot in Telegram')
  console.log('3. Copy the chat ID and paste it here\n')
  const chatId = await ask('Your Telegram chat ID: ')
  if (chatId.trim()) {
    let envContent = readFileSync(envPath, 'utf8')
    envContent = envContent.replace('ALLOWED_CHAT_ID=', `ALLOWED_CHAT_ID=${chatId.trim()}`)
    writeFileSync(envPath, envContent, 'utf8')
    ok(`Chat ID saved: ${chatId.trim()}`)
  } else {
    warn('No chat ID entered. Edit .env manually to set ALLOWED_CHAT_ID.')
  }

  // ── Docker setup ───────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Docker setup${RESET}\n`)
  console.log('To run as a Docker container:\n')
  console.log(`  cd ${PROJECT_ROOT}`)
  console.log('  docker compose up -d\n')
  console.log('To view logs:')
  console.log('  docker compose logs -f\n')
  console.log('To stop:')
  console.log('  docker compose down\n')

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log(`\n${GREEN}${BOLD}Setup complete!${RESET}\n`)
  console.log('Next steps:')
  console.log(`  ${BOLD}Start with Docker:${RESET}  docker compose up -d`)
  console.log(`  ${BOLD}Start locally:${RESET}       npm start`)
  console.log(`  ${BOLD}Dev mode:${RESET}            npm run dev`)
  console.log(`  ${BOLD}Check status:${RESET}        npm run status`)
  console.log(`\nDashboard (when running): http://localhost:3847`)

  rl.close()
}

main().catch(err => {
  fail(`Setup failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
