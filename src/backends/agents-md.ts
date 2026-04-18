import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import os from 'os'
import { PROJECT_ROOT } from '../config.js'
import { logger } from '../logger.js'

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')
const CLAUDE_MD = path.join(PROJECT_ROOT, 'CLAUDE.md')
const AGENTS_MD = path.join(PROJECT_ROOT, 'AGENTS.md')

export function regenerateAgentsMd(): void {
  const parts: string[] = []

  try {
    parts.push(readFileSync(CLAUDE_MD, 'utf8').trimEnd())
  } catch {
    // CLAUDE.md may not exist in dev; proceed with just skills
  }

  let skills: string[] = []
  try {
    skills = readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(SKILLS_DIR, f))
      .filter((p) => {
        try { return statSync(p).isFile() } catch { return false }
      })
      .sort()
  } catch {
    // no skills dir, skip
  }

  if (skills.length > 0) {
    parts.push('')
    parts.push('---')
    parts.push('')
    parts.push('# Skills')
    parts.push('')
    parts.push("Each section below is a skill. Its YAML frontmatter lists trigger phrases -- when the user's request matches, follow that skill's instructions.")

    for (const skill of skills) {
      const name = path.basename(skill, '.md')
      let body = ''
      try {
        body = readFileSync(skill, 'utf8').trimEnd()
      } catch (err) {
        logger.warn({ skill, err }, 'failed to read skill')
        continue
      }
      parts.push('')
      parts.push('---')
      parts.push('')
      parts.push(`## Skill: ${name}`)
      parts.push('')
      parts.push(body)
    }
  }

  writeFileSync(AGENTS_MD, parts.join('\n') + '\n', 'utf8')
  logger.info({ file: AGENTS_MD, skills: skills.length }, 'regenerated AGENTS.md')
}
