import { getBackend } from './backends/index.js'
import type { AgentBackend, AgentUsage } from './backends/types.js'

let _backend: AgentBackend | undefined

export async function runAgent(
  message: string,
  sessionId?: string,
  onTyping?: () => void,
  onSubTask?: (description: string) => void,
  onUsage?: (usage: AgentUsage) => void
): Promise<{ text: string | null; newSessionId?: string }> {
  if (!_backend) _backend = await getBackend()
  return _backend.run({ message, sessionId, onTyping, onSubTask, onUsage })
}
