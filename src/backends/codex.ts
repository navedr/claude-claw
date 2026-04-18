import { spawn } from 'child_process'
import { createRequire } from 'module'
import { PROJECT_ROOT } from '../config.js'
import { logger } from '../logger.js'
import { regenerateAgentsMd } from './agents-md.js'
import type { AgentBackend, AgentRunArgs, AgentRunResult } from './types.js'

const _require = createRequire(import.meta.url)

function resolveCodexPath(): string {
  const candidates = [
    '@openai/codex/bin/codex.js',
    '@openai/codex/dist/cli.js',
    '@openai/codex',
  ]
  for (const c of candidates) {
    try {
      return _require.resolve(c)
    } catch {
      // try next
    }
  }
  throw new Error(
    'Could not resolve @openai/codex CLI. Tried: ' + candidates.join(', '),
  )
}

function pickString(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

function pickNumber(obj: any, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'number') return v
  }
  return undefined
}

function isResumeMissError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /no rollout found|thread\/resume|unknown session|session not found/i.test(msg)
}

export const codexBackend: AgentBackend = {
  async run(args: AgentRunArgs): Promise<AgentRunResult> {
    try {
      regenerateAgentsMd()
    } catch (err) {
      logger.warn({ err }, 'failed to regenerate AGENTS.md; continuing')
    }

    try {
      return await spawnCodex(args)
    } catch (err) {
      if (args.sessionId && isResumeMissError(err)) {
        logger.warn({ sessionId: args.sessionId }, 'codex resume failed; retrying without session')
        return spawnCodex({ ...args, sessionId: undefined })
      }
      throw err
    }
  },
}

async function spawnCodex({ message, sessionId, onTyping, onSubTask, onUsage }: AgentRunArgs): Promise<AgentRunResult> {
  let resultText: string | null = null
  let newSessionId: string | undefined

  const codexPath = resolveCodexPath()

  // codex CLI layout:
  //   fresh:  codex exec [--json] [-m MODEL] -- <PROMPT>
  //   resume: codex exec resume [--json] [-m MODEL] -- <SESSION_ID> <PROMPT>
  const cliArgs: string[] = [codexPath, 'exec']
  if (sessionId) cliArgs.push('resume')
  cliArgs.push('--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox')
  const model = process.env.CODEX_MODEL
  if (model) cliArgs.push('-m', model)
  cliArgs.push('--')
  if (sessionId) cliArgs.push(sessionId)
  cliArgs.push(message)

  logger.info({ cwd: PROJECT_ROOT, cli: codexPath, sessionId, model }, 'codexBackend started')

  const typingInterval = onTyping
    ? setInterval(() => onTyping(), 4000)
    : null

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, cliArgs, {
        cwd: PROJECT_ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdoutBuf = ''
      let stderrBuf = ''

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8')
        let idx: number
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, idx).trim()
          stdoutBuf = stdoutBuf.slice(idx + 1)
          if (!line) continue
          let event: any
          try {
            event = JSON.parse(line)
          } catch {
            logger.warn({ line }, 'codex non-json stdout line')
            continue
          }
          try {
            handleEvent(event)
          } catch (err) {
            logger.warn({ err, event }, 'codex event handler error')
          }
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        const s = chunk.toString('utf8')
        stderrBuf += s
        logger.error({ stderr: s }, 'codex stderr')
      })

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn codex: ${err.message}`))
      })

      child.on('close', (code) => {
        if (stdoutBuf.trim()) {
          try {
            const event = JSON.parse(stdoutBuf.trim())
            handleEvent(event)
          } catch {
            // ignore trailing junk
          }
        }
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`codex exited with code ${code}: ${stderrBuf.slice(0, 500)}`))
        }
      })

      function handleEvent(event: any) {
        if (!event || typeof event !== 'object') return

        const type: string | undefined = typeof event.type === 'string' ? event.type : undefined

        const sid = pickString(event, ['session_id', 'conversation_id', 'rollout_id'])
          ?? pickString(event.session, ['id', 'session_id'])
          ?? pickString(event.conversation, ['id', 'conversation_id'])
        if (sid) {
          newSessionId = sid
        }

        const description = pickString(event, ['description'])
          ?? pickString(event.task, ['description', 'name'])
          ?? pickString(event.tool, ['description', 'name'])
        if (description && onSubTask) {
          if (
            type === 'task_started' ||
            type === 'tool_started' ||
            type === 'tool_call' ||
            type === 'task' ||
            event.task ||
            event.tool ||
            !type
          ) {
            onSubTask(description)
          }
        }

        const text = pickString(event, ['text', 'message', 'result', 'content'])
          ?? pickString(event.message, ['text', 'content'])
          ?? pickString(event.result, ['text', 'message', 'content'])
        if (
          text && (
            type === 'agent_message' ||
            type === 'assistant_message' ||
            type === 'message' ||
            type === 'result' ||
            type === 'final' ||
            type === 'completion'
          )
        ) {
          resultText = text
        }

        const usageObj = event.usage ?? (type === 'token_count' || type === 'usage' ? event : undefined)
        if (usageObj && onUsage) {
          const input_tokens = pickNumber(usageObj, ['input_tokens', 'prompt_tokens', 'input'])
          const output_tokens = pickNumber(usageObj, ['output_tokens', 'completion_tokens', 'output'])
          if (input_tokens !== undefined || output_tokens !== undefined) {
            onUsage({
              input_tokens: input_tokens ?? 0,
              output_tokens: output_tokens ?? 0,
              cache_read_input_tokens: 0,
            })
          }
        }
      }
    })
  } finally {
    if (typingInterval) clearInterval(typingInterval)
  }

  return { text: resultText, newSessionId }
}
