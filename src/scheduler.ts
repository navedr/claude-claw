import cron from 'node-cron'
import { getActiveTasks, updateTaskAfterRun } from './db.js'
import { runAgent } from './agent.js'
import { logger } from './logger.js'

export type Sender = (chatId: string, text: string) => Promise<void>

const jobs = new Map<string, cron.ScheduledTask>()
const running = new Set<string>()

function registerTask(
  task: { id: string; chat_id: string; prompt: string; schedule: string },
  send: Sender,
): void {
  if (jobs.has(task.id)) return

  if (!cron.validate(task.schedule)) {
    logger.warn({ taskId: task.id, schedule: task.schedule }, 'invalid cron expression, skipping')
    return
  }

  const job = cron.schedule(task.schedule, async () => {
    if (running.has(task.id)) {
      logger.warn({ taskId: task.id }, 'task still running, skipping this tick')
      return
    }
    running.add(task.id)
    logger.info({ taskId: task.id }, 'Running scheduled task')
    try {
      await send(task.chat_id, `⏰ Running scheduled task: "${task.prompt}"`)
      const { text } = await runAgent(task.prompt)
      const result = text ?? '(no response)'
      await send(task.chat_id, result)
      updateTaskAfterRun(task.id, result)
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Scheduled task failed')
      const errMsg = err instanceof Error ? err.message : String(err)
      await send(task.chat_id, `❌ Scheduled task failed: ${errMsg}`)
      updateTaskAfterRun(task.id, `ERROR: ${errMsg}`)
    } finally {
      running.delete(task.id)
    }
  })

  jobs.set(task.id, job)
  logger.info({ taskId: task.id, schedule: task.schedule }, 'registered cron job')
}

function syncTasks(send: Sender): void {
  const tasks = getActiveTasks()
  const activeIds = new Set(tasks.map((t) => t.id))

  for (const task of tasks) {
    registerTask(task, send)
  }

  for (const [id, job] of jobs) {
    if (!activeIds.has(id)) {
      job.stop()
      jobs.delete(id)
      running.delete(id)
      logger.info({ taskId: id }, 'unregistered removed/paused cron job')
    }
  }
}

export function initScheduler(send: Sender): void {
  syncTasks(send)

  process.on('SIGUSR1', () => {
    logger.info('SIGUSR1 received, syncing scheduled tasks')
    syncTasks(send)
  })

  logger.info(`Scheduler started (${jobs.size} jobs, signal-driven sync)`)
}
