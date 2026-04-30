import type { AgentBackend } from './types.js'

export async function getBackend(): Promise<AgentBackend> {
  const provider = (process.env.BACKEND_PROVIDER ?? 'claude').toLowerCase()
  if (provider === 'codex') {
    const { codexBackend } = await import('./codex.js')
    return codexBackend
  }
  const { claudeBackend } = await import('./claude.js')
  return claudeBackend
}
