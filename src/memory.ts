import { appendFileSync, existsSync, writeFileSync } from 'fs'
import path from 'path'
import { PROJECT_ROOT } from './config.js'
import {
  insertMemory,
  searchMemoriesFts,
  getRecentMemories,
  touchMemory,
  decayMemories as dbDecayMemories,
} from './db.js'

const MEMORY_FILE = path.join(PROJECT_ROOT, 'memory.md')
const MEMORY_HEADER = `# Persistent Memories\n_Semantic facts learned over time. Read this at the start of every session._\n\n`
const SEMANTIC_PATTERN = /\b(my|i am|i'm|i prefer|remember|always|never)\b/i

export async function buildMemoryContext(chatId: string, userMessage: string): Promise<string> {
  const sanitized = userMessage
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .map(w => w + '*')
    .join(' ')

  const ftsResults = sanitized
    ? searchMemoriesFts(chatId, sanitized, 3)
    : []

  const recentResults = getRecentMemories(chatId, 5)

  const seen = new Set<number>()
  const combined: Array<{ id: number; content: string; sector: string }> = []
  for (const r of [...ftsResults, ...recentResults]) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      combined.push(r)
    }
  }

  for (const m of combined) {
    touchMemory(m.id)
  }

  if (combined.length === 0) return ''

  const lines = combined.map(m => `- ${m.content} (${m.sector})`).join('\n')
  return `[Memory context]\n${lines}`
}

export async function saveConversationTurn(chatId: string, userMsg: string, assistantMsg: string): Promise<void> {
  const content = `User: ${userMsg}\nAssistant: ${assistantMsg}`
  if (content.length <= 20 || userMsg.startsWith('/')) return

  const isSemantic = SEMANTIC_PATTERN.test(userMsg)
  const sector: 'semantic' | 'episodic' = isSemantic ? 'semantic' : 'episodic'

  insertMemory(chatId, content, sector)

  if (isSemantic) {
    if (!existsSync(MEMORY_FILE)) {
      writeFileSync(MEMORY_FILE, MEMORY_HEADER, 'utf8')
    }
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    appendFileSync(MEMORY_FILE, `- [${timestamp}] ${userMsg}\n`, 'utf8')
  }
}

export function runDecaySweep(): void {
  dbDecayMemories()
}
