import { Codex, type ThreadEvent, type ThreadItem, type ThreadOptions } from '@openai/codex-sdk'
import { PROJECT_ROOT } from '../config.js'
import { logger } from '../logger.js'
import { regenerateAgentsMd } from './agents-md.js'
import type { AgentBackend, AgentRunArgs, AgentRunResult } from './types.js'

function isResumeMissError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /no rollout found|thread\/resume|unknown session|session not found/i.test(msg)
}

function threadOptions(): ThreadOptions {
  const model = process.env.CODEX_MODEL
  return {
    workingDirectory: PROJECT_ROOT,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    ...(model ? { model } : {}),
  }
}

function describeItem(item: ThreadItem): string | undefined {
  if (item.type === 'command_execution') return item.command
  if (item.type === 'web_search') return item.query
  if (item.type === 'mcp_tool_call') return item.server + '.' + item.tool
  if (item.type === 'file_change') return item.changes.map(change => change.kind + ': ' + change.path).join(', ')
  return item.type === 'agent_message' || item.type === 'reasoning' ? item.text : undefined
}

export const codexBackend: AgentBackend = {
  async run(args: AgentRunArgs): Promise<AgentRunResult> {
    try {
      regenerateAgentsMd()
    } catch (err) {
      logger.warn({ err }, 'failed to regenerate AGENTS.md; continuing')
    }

    try {
      return await runCodex(args)
    } catch (err) {
      if (args.sessionId && isResumeMissError(err)) {
        logger.warn({ sessionId: args.sessionId }, 'codex resume failed; retrying without session')
        return runCodex({ ...args, sessionId: undefined })
      }
      throw err
    }
  },
}

async function runCodex({ message, sessionId, onTyping, onSubTask, onUsage }: AgentRunArgs): Promise<AgentRunResult> {
  const codex = new Codex({ apiKey: process.env.OPENAI_API_KEY || undefined })
  const options = threadOptions()
  const thread = sessionId ? codex.resumeThread(sessionId, options) : codex.startThread(options)
  let resultText: string | null = null
  let newSessionId: string | undefined = sessionId

  logger.info({ cwd: PROJECT_ROOT, sessionId, model: options.model }, 'codex SDK turn started')

  const typingInterval = onTyping ? setInterval(() => onTyping(), 4000) : null
  try {
    const { events } = await thread.runStreamed(message)
    for await (const event of events) handleEvent(event)
  } finally {
    if (typingInterval) clearInterval(typingInterval)
  }

  return { text: resultText, newSessionId: newSessionId ?? thread.id ?? undefined }

  function handleEvent(event: ThreadEvent): void {
    if (event.type === 'thread.started') {
      newSessionId = event.thread_id
      return
    }
    if (event.type === 'turn.failed') throw new Error(event.error.message)
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'turn.completed') {
      onUsage?.({
        input_tokens: event.usage.input_tokens,
        output_tokens: event.usage.output_tokens,
        cache_read_input_tokens: event.usage.cached_input_tokens,
      })
      return
    }
    if (event.type === 'item.completed' && event.item.type === 'agent_message') {
      resultText = event.item.text
      return
    }
    if (event.type === 'item.started') {
      const description = describeItem(event.item)
      if (description) onSubTask?.(description.length > 120 ? description.slice(0, 117) + '...' : description)
    }
  }
}
