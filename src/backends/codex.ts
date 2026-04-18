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

      // Codex JSON event shapes (as of @openai/codex current):
      //   { type: "thread.started", thread_id }
      //   { type: "turn.started" }
      //   { type: "item.started",   item: { id, type: "command_execution"|"agent_message"|..., ... } }
      //   { type: "item.completed", item: { id, type, text?, command?, ... } }
      //   { type: "turn.completed", usage: { input_tokens, output_tokens, cached_input_tokens } }
      //   { type: "error" | "turn.failed", ... }
      function handleEvent(event: any) {
        if (!event || typeof event !== 'object') return
        const type: string | undefined = typeof event.type === 'string' ? event.type : undefined

        if (type === 'thread.started') {
          const tid = pickString(event, ['thread_id', 'session_id', 'conversation_id', 'rollout_id'])
          if (tid) newSessionId = tid
          return
        }

        if (type === 'item.started' || type === 'item.completed') {
          const item = event.item ?? {}
          const itemType: string | undefined = typeof item.type === 'string' ? item.type : undefined

          if (type === 'item.completed' && itemType === 'agent_message') {
            const text = pickString(item, ['text', 'message', 'content'])
            if (text) resultText = text
            return
          }

          if (type === 'item.started' && onSubTask) {
            const desc =
              pickString(item, ['description', 'name', 'command', 'tool_name', 'text']) ??
              (itemType ? `[${itemType}]` : undefined)
            if (desc) onSubTask(desc.length > 120 ? desc.slice(0, 117) + '...' : desc)
          }
          return
        }

        if (type === 'turn.completed' && event.usage && onUsage) {
          const u = event.usage
          const input_tokens = pickNumber(u, ['input_tokens', 'prompt_tokens', 'input']) ?? 0
          const output_tokens = pickNumber(u, ['output_tokens', 'completion_tokens', 'output']) ?? 0
          const cache_read_input_tokens = pickNumber(u, ['cached_input_tokens', 'cache_read_input_tokens']) ?? 0
          onUsage({ input_tokens, output_tokens, cache_read_input_tokens })
          return
        }
      }
    })
  } finally {
    if (typingInterval) clearInterval(typingInterval)
  }

  return { text: resultText, newSessionId }
}
