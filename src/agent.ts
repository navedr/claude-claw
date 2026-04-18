import { getBackend } from './backends/index.js'
import type { AgentUsage } from './backends/types.js'

const backend = getBackend()

export async function runAgent(
  message: string,
  sessionId?: string,
  onTyping?: () => void,
  onSubTask?: (description: string) => void,
  onUsage?: (usage: AgentUsage) => void
): Promise<{ text: string | null; newSessionId?: string }> {
  return backend.run({ message, sessionId, onTyping, onSubTask, onUsage })
}
