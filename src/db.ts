import { STORE_DIR } from './config.js'
import path from 'path'
import { mkdirSync } from 'fs'

let Database: typeof import('better-sqlite3')
try {
  const mod = await import('better-sqlite3')
  Database = mod.default
} catch (err) {
  console.error('[ERROR] SQLite failed to load. Run: npm install && npm run build')
  console.error('If the error persists: npm rebuild better-sqlite3')
  process.exit(1)
}

mkdirSync(STORE_DIR, { recursive: true })
const db = new Database(path.join(STORE_DIR, 'claudeclaw.db'))
db.pragma('journal_mode = WAL')

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic_key TEXT,
      content TEXT NOT NULL,
      sector TEXT NOT NULL CHECK(sector IN ('semantic','episodic')),
      salience REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content='memories',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL,
      next_run INTEGER NOT NULL,
      last_run INTEGER,
      last_result TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_run ON scheduled_tasks(status, next_run);

    CREATE TABLE IF NOT EXISTS job_log (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('message','scheduler','team')),
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','done','failed')),
      response TEXT,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id TEXT NOT NULL,
      agent_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','done','failed')),
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (correlation_id) REFERENCES job_log(id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_tasks_corr ON agent_tasks(correlation_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_dedup
      ON agent_tasks(correlation_id, agent_label);

    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id TEXT NOT NULL,
      api TEXT NOT NULL CHECK(api IN ('claude','groq','elevenlabs','gemini')),
      metric TEXT NOT NULL,
      value INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (correlation_id) REFERENCES job_log(id)
    );

    CREATE INDEX IF NOT EXISTS idx_usage_log_corr ON usage_log(correlation_id, api);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_dedup
      ON usage_log(correlation_id, api, metric, created_at);
  `)
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function getSession(chatId: string): string | null {
  const row = db.prepare('SELECT session_id FROM sessions WHERE chat_id = ?').get(chatId) as { session_id: string } | undefined
  return row?.session_id ?? null
}

export function setSession(chatId: string, sessionId: string): void {
  db.prepare('INSERT OR REPLACE INTO sessions (chat_id, session_id, updated_at) VALUES (?, ?, ?)')
    .run(chatId, sessionId, Date.now())
}

export function clearSession(chatId: string): void {
  db.prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId)
}

// ── Memories ──────────────────────────────────────────────────────────────────

export function insertMemory(chatId: string, content: string, sector: 'semantic' | 'episodic', topicKey?: string): number {
  const now = Date.now()
  const result = db.prepare(
    'INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at) VALUES (?, ?, ?, ?, 1.0, ?, ?)'
  ).run(chatId, topicKey ?? null, content, sector, now, now)
  return result.lastInsertRowid as number
}

export function searchMemoriesFts(chatId: string, query: string, limit = 3): Array<{ id: number; content: string; sector: string }> {
  return db.prepare(
    `SELECT m.id, m.content, m.sector FROM memories m
     JOIN memories_fts f ON f.rowid = m.id
     WHERE f.memories_fts MATCH ? AND m.chat_id = ?
     ORDER BY rank LIMIT ?`
  ).all(query, chatId, limit) as Array<{ id: number; content: string; sector: string }>
}

export function getRecentMemories(chatId: string, limit = 5): Array<{ id: number; content: string; sector: string }> {
  return db.prepare(
    'SELECT id, content, sector FROM memories WHERE chat_id = ? ORDER BY accessed_at DESC LIMIT ?'
  ).all(chatId, limit) as Array<{ id: number; content: string; sector: string }>
}

export function touchMemory(id: number): void {
  db.prepare(
    'UPDATE memories SET accessed_at = ?, salience = MIN(salience + 0.1, 5.0) WHERE id = ?'
  ).run(Date.now(), id)
}

export function decayMemories(): void {
  const oneDayAgo = Date.now() - 86400 * 1000
  db.prepare('UPDATE memories SET salience = salience * 0.98 WHERE created_at < ?').run(oneDayAgo)
  db.prepare('DELETE FROM memories WHERE salience < 0.1').run()
}

export function getMemoriesForDisplay(chatId: string, limit = 10): Array<{ content: string; sector: string; created_at: number }> {
  return db.prepare(
    'SELECT content, sector, created_at FROM memories WHERE chat_id = ? ORDER BY accessed_at DESC LIMIT ?'
  ).all(chatId, limit) as Array<{ content: string; sector: string; created_at: number }>
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function createScheduledTask(id: string, chatId: string, prompt: string, schedule: string, nextRun: number): void {
  db.prepare(
    'INSERT INTO scheduled_tasks (id, chat_id, prompt, schedule, next_run, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, chatId, prompt, schedule, nextRun, 'active', Date.now())
}

export function getActiveTasks(): Array<{ id: string; chat_id: string; prompt: string; schedule: string }> {
  return db.prepare(
    "SELECT id, chat_id, prompt, schedule FROM scheduled_tasks WHERE status = 'active'"
  ).all() as Array<{ id: string; chat_id: string; prompt: string; schedule: string }>
}

export function updateTaskAfterRun(id: string, result: string): void {
  db.prepare(
    'UPDATE scheduled_tasks SET last_run = ?, last_result = ? WHERE id = ?'
  ).run(Math.floor(Date.now() / 1000), result, id)
}

export function listScheduledTasks(): Array<{ id: string; chat_id: string; prompt: string; schedule: string; status: string; next_run: number; last_run: number | null }> {
  return db.prepare('SELECT id, chat_id, prompt, schedule, status, next_run, last_run FROM scheduled_tasks ORDER BY created_at DESC').all() as Array<{ id: string; chat_id: string; prompt: string; schedule: string; status: string; next_run: number; last_run: number | null }>
}

export function deleteScheduledTask(id: string): void {
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
}

export function pauseScheduledTask(id: string): void {
  db.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run('paused', id)
}

export function resumeScheduledTask(id: string): void {
  db.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run('active', id)
}

// ── Dashboard / Job Log ───────────────────────────────────────────────────────

export function createJob(id: string, chatId: string, source: 'message' | 'scheduler' | 'team', prompt: string): void {
  db.prepare(
    'INSERT INTO job_log (id, chat_id, source, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, chatId, source, prompt, 'running', Date.now())
}

export function completeJob(id: string, response: string, durationMs: number, status: 'done' | 'failed'): void {
  db.prepare(
    'UPDATE job_log SET status = ?, response = ?, duration_ms = ?, completed_at = ? WHERE id = ?'
  ).run(status, response, durationMs, Date.now(), id)
}

export function createAgentTask(correlationId: string, agentLabel: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO agent_tasks (correlation_id, agent_label, status, created_at) VALUES (?, ?, ?, ?)'
  ).run(correlationId, agentLabel, 'running', Date.now())
}

export function completeAgentTask(correlationId: string, agentLabel: string, status: 'done' | 'failed'): void {
  db.prepare(
    'UPDATE agent_tasks SET status = ?, completed_at = ? WHERE correlation_id = ? AND agent_label = ?'
  ).run(status, Date.now(), correlationId, agentLabel)
}

export function logUsage(correlationId: string, api: string, metric: string, value: number): void {
  db.prepare(
    'INSERT OR IGNORE INTO usage_log (correlation_id, api, metric, value, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(correlationId, api, metric, value, Date.now())
}

export function getJobsWithTasks(limit = 50): unknown[] {
  const jobs = db.prepare(
    'SELECT * FROM job_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as Array<Record<string, unknown>>

  return jobs.map(job => {
    const tasks = db.prepare(
      'SELECT * FROM agent_tasks WHERE correlation_id = ? ORDER BY created_at ASC'
    ).all(job['id'] as string)
    return { ...job, tasks }
  })
}

export function getUsageTotals(correlationId?: string): unknown[] {
  if (correlationId) {
    return db.prepare(
      'SELECT api, metric, SUM(value) as total FROM usage_log WHERE correlation_id = ? GROUP BY api, metric'
    ).all(correlationId) as unknown[]
  }
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  return db.prepare(
    'SELECT api, metric, SUM(value) as total FROM usage_log WHERE created_at >= ? GROUP BY api, metric'
  ).all(todayStart.getTime()) as unknown[]
}

export function deleteJob(id: string): void {
  db.prepare('DELETE FROM usage_log WHERE correlation_id = ?').run(id)
  db.prepare('DELETE FROM agent_tasks WHERE correlation_id = ?').run(id)
  db.prepare('DELETE FROM job_log WHERE id = ?').run(id)
}

export { db }
