import { randomUUID } from 'crypto'
import { initDatabase, createScheduledTask, listScheduledTasks, deleteScheduledTask, pauseScheduledTask, resumeScheduledTask } from './db.js'
import cron from 'node-cron'

initDatabase()

const [, , cmd, ...args] = process.argv

function printUsage(): void {
  console.log(`
Usage: node dist/schedule-cli.js <command>

Commands:
  create "<prompt>" "<cron>" <chat_id>   Create a new scheduled task
  list                                    List all tasks
  delete <id>                             Delete a task
  pause <id>                              Pause a task
  resume <id>                             Resume a paused task
`)
}

function validateCron(expr: string): boolean {
  return cron.validate(expr)
}

switch (cmd) {
  case 'create': {
    const [prompt, schedule, chatId] = args
    if (!prompt || !schedule || !chatId) {
      console.error('Usage: create "<prompt>" "<cron>" <chat_id>')
      process.exit(1)
    }
    if (!validateCron(schedule)) {
      console.error(`Invalid cron expression: ${schedule}`)
      process.exit(1)
    }
    const id = randomUUID().slice(0, 8)
    createScheduledTask(id, chatId, prompt, schedule, 0)
    console.log(`Created task ${id}`)
    console.log(`  Prompt: ${prompt}`)
    console.log(`  Schedule: ${schedule}`)
    break
  }

  case 'list': {
    const tasks = listScheduledTasks()
    if (tasks.length === 0) {
      console.log('No scheduled tasks.')
      break
    }
    console.log('\nScheduled Tasks:')
    console.log('─'.repeat(80))
    for (const t of tasks) {
      const nextStr = new Date(t.next_run * 1000).toLocaleString()
      const lastStr = t.last_run ? new Date(t.last_run * 1000).toLocaleString() : 'never'
      console.log(`[${t.id}] ${t.status.toUpperCase()} — ${t.schedule}`)
      console.log(`  Prompt: ${t.prompt}`)
      console.log(`  Next: ${nextStr}  Last: ${lastStr}`)
      console.log()
    }
    break
  }

  case 'delete': {
    const [id] = args
    if (!id) { console.error('Usage: delete <id>'); process.exit(1) }
    deleteScheduledTask(id)
    console.log(`Deleted task ${id}`)
    break
  }

  case 'pause': {
    const [id] = args
    if (!id) { console.error('Usage: pause <id>'); process.exit(1) }
    pauseScheduledTask(id)
    console.log(`Paused task ${id}`)
    break
  }

  case 'resume': {
    const [id] = args
    if (!id) { console.error('Usage: resume <id>'); process.exit(1) }
    resumeScheduledTask(id)
    console.log(`Resumed task ${id}`)
    break
  }

  default:
    printUsage()
    break
}
