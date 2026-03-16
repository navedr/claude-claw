import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import path from 'path'
import { STORE_DIR, TELEGRAM_BOT_TOKEN } from './config.js'
import { logger } from './logger.js'
import { initDatabase, db } from './db.js'
import { runDecaySweep } from './memory.js'
import { cleanupOldUploads } from './media.js'
import { createBot } from './bot.js'
import { initScheduler } from './scheduler.js'
import { initDashboard } from './dashboard.js'

const PID_FILE = path.join(STORE_DIR, 'claudeclaw.pid')

function acquireLock(): void {
  mkdirSync(STORE_DIR, { recursive: true })
  if (existsSync(PID_FILE)) {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').trim())
    if (oldPid && !isNaN(oldPid)) {
      try {
        process.kill(oldPid, 0)
        logger.info({ oldPid }, 'Killing stale instance')
        process.kill(oldPid, 'SIGTERM')
      } catch {
        // Process doesn't exist — stale PID file
      }
    }
  }
  writeFileSync(PID_FILE, String(process.pid), 'utf8')
}

function releaseLock(): void {
  try { unlinkSync(PID_FILE) } catch { /* ignore */ }
}

async function showBanner(): Promise<void> {
  const banner = `
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
 ██████╗██╗      █████╗ ██╗    ██╗
██╔════╝██║     ██╔══██╗██║    ██║
██║     ██║     ███████║██║ █╗ ██║
██║     ██║     ██╔══██║██║███╗██║
╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
`
  console.log(banner)
}

async function main(): Promise<void> {
  await showBanner()

  acquireLock()
  initDatabase()

  // Memory decay sweep
  runDecaySweep()
  setInterval(runDecaySweep, 24 * 60 * 60 * 1000)

  // Clean up old uploads
  cleanupOldUploads()

  // Dashboard
  initDashboard(db)

  logger.info('ClaudeClaw running')

  // Graceful shutdown
  let bot: ReturnType<typeof createBot> | null = null
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down')
    releaseLock()
    if (bot) await bot.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)) })
  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)) })

  // Bot (non-blocking -- dashboard stays up even if bot fails)
  if (!TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN not set -- bot disabled, dashboard-only mode')
  } else {
    bot = createBot()

    // Scheduler (needs bot for sending messages)
    initScheduler(async (chatId, text) => {
      await bot!.api.sendMessage(chatId, text)
    })

    try {
      await bot.start()
    } catch (err) {
      logger.error({ err }, 'Bot failed to start')
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg.includes('409')) {
        logger.warn('Another bot instance is polling -- bot disabled, dashboard still running')
      } else if (errMsg.includes('401')) {
        logger.warn('Invalid TELEGRAM_BOT_TOKEN -- bot disabled, dashboard still running')
      }
    }
  }
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error')
  releaseLock()
  process.exit(1)
})
