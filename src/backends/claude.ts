import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { PROJECT_ROOT } from '../config.js'
import { createRequire } from 'module'
import { logger } from '../logger.js'
import type { AgentBackend, AgentRunArgs, AgentRunResult } from './types.js'

const _require = createRequire(import.meta.url)
const CLAUDE_CLI_PATH: string = _require.resolve('@anthropic-ai/claude-code/cli.js')

export const claudeBackend: AgentBackend = {
  async run({ message, sessionId, onTyping, onSubTask, onUsage }: AgentRunArgs): Promise<AgentRunResult> {
    let resultText: string | null = null
    let newSessionId: string | undefined

    const typingInterval = onTyping
      ? setInterval(() => onTyping(), 4000)
      : null

    try {
      const events = query({
        prompt: message,
        options: {
          cwd: PROJECT_ROOT,
          resume: sessionId,
          settingSources: ['project', 'user'],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          pathToClaudeCodeExecutable: CLAUDE_CLI_PATH,
          debug: true,
          stderr: (data: string) => logger.error({ stderr: data }, 'claude stderr'),
        },
      })

      logger.info({ cwd: PROJECT_ROOT, cli: CLAUDE_CLI_PATH, sessionId }, 'runAgent started')

      for await (const event of events as AsyncGenerator<SDKMessage>) {
        if (event.type === 'system') {
          if (event.subtype === 'init') {
            newSessionId = event.session_id
          } else if (event.subtype === 'task_started') {
            const taskEvent = event as { subtype: 'task_started'; description: string }
            if (taskEvent.description && onSubTask) {
              onSubTask(taskEvent.description)
            }
          }
        } else if (event.type === 'result') {
          if (event.subtype === 'success') {
            resultText = event.result ?? null
            newSessionId = event.session_id
            if (event.usage && onUsage) {
              const u = event.usage as {
                input_tokens?: number
                output_tokens?: number
                cache_read_input_tokens?: number
              }
              onUsage({
                input_tokens: u.input_tokens ?? 0,
                output_tokens: u.output_tokens ?? 0,
                cache_read_input_tokens: u.cache_read_input_tokens,
              })
            }
          }
        }
      }
    } finally {
      if (typingInterval) clearInterval(typingInterval)
    }

    return { text: resultText, newSessionId }
  },
}
