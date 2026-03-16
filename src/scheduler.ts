import pkg from 'cron-parser'
const { parseExpression } = pkg
import { getDueTasks, updateTaskAfterRun } from './db.js'
import { runAgent } from './agent.js'
import { logger } from './logger.js'

export type Sender = (chatId: string, text: string) => Promise<void>

export function computeNextRun(cronExpression: string): number {
  const interval = parseExpression(cronExpression)
  return Math.floor(interval.next().getTime() / 1000)
}

export async function runDueTasks(send: Sender): Promise<void> {
  const tasks = getDueTasks()
  for (const task of tasks) {
    logger.info({ taskId: task.id }, 'Running scheduled task')
    try {
      await send(task.chat_id, `⏰ Running scheduled task: "${task.prompt}"`)
      const { text } = await runAgent(task.prompt)
      const result = text ?? '(no response)'
      await send(task.chat_id, result)
      updateTaskAfterRun(task.id, result, computeNextRun(task.schedule))
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Scheduled task failed')
      const errMsg = err instanceof Error ? err.message : String(err)
      await send(task.chat_id, `❌ Scheduled task failed: ${errMsg}`)
      updateTaskAfterRun(task.id, `ERROR: ${errMsg}`, computeNextRun(task.schedule))
    }
  }
}

export function initScheduler(send: Sender): void {
  setInterval(() => {
    runDueTasks(send).catch(err => logger.error({ err }, 'Scheduler error'))
  }, 60_000)
  logger.info('Scheduler started (polling every 60s)')
}
