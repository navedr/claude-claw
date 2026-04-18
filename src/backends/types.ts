export type AgentUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
}

export type AgentRunArgs = {
  message: string
  sessionId?: string
  onTyping?: () => void
  onSubTask?: (description: string) => void
  onUsage?: (usage: AgentUsage) => void
}

export type AgentRunResult = {
  text: string | null
  newSessionId?: string
}

export interface AgentBackend {
  run(args: AgentRunArgs): Promise<AgentRunResult>
}
