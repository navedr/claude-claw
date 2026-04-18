import { claudeBackend } from './claude.js'
import { codexBackend } from './codex.js'
import type { AgentBackend } from './types.js'

export function getBackend(): AgentBackend {
  const provider = (process.env.BACKEND_PROVIDER ?? 'claude').toLowerCase()
  return provider === 'codex' ? codexBackend : claudeBackend
}
