import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ENV_PATH = path.join(PROJECT_ROOT, '.env')

describe('readEnvFile', () => {
  const originalEnv = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : null

  function readFileSync(p: string, enc: string): string {
    const { readFileSync: rfs } = require('fs')
    return rfs(p, enc)
  }

  afterEach(() => {
    if (originalEnv !== null) {
      writeFileSync(ENV_PATH, originalEnv, 'utf8')
    } else if (existsSync(ENV_PATH)) {
      unlinkSync(ENV_PATH)
    }
  })

  it('parses simple key=value', async () => {
    writeFileSync(ENV_PATH, 'FOO=bar\nBAZ=qux\n', 'utf8')
    const { readEnvFile } = await import('./env.js')
    const result = readEnvFile()
    expect(result['FOO']).toBe('bar')
    expect(result['BAZ']).toBe('qux')
  })

  it('strips quoted values', async () => {
    writeFileSync(ENV_PATH, 'A="hello world"\nB=\'single\'\n', 'utf8')
    const { readEnvFile } = await import('./env.js')
    const result = readEnvFile()
    expect(result['A']).toBe('hello world')
    expect(result['B']).toBe('single')
  })

  it('skips comments', async () => {
    writeFileSync(ENV_PATH, '# comment\nKEY=val\n', 'utf8')
    const { readEnvFile } = await import('./env.js')
    const result = readEnvFile()
    expect(result['KEY']).toBe('val')
    expect(Object.keys(result)).not.toContain('# comment')
  })

  it('returns {} if .env missing', async () => {
    if (existsSync(ENV_PATH)) unlinkSync(ENV_PATH)
    const { readEnvFile } = await import('./env.js')
    const result = readEnvFile()
    expect(result).toEqual({})
  })

  it('filters by keys array', async () => {
    writeFileSync(ENV_PATH, 'A=1\nB=2\nC=3\n', 'utf8')
    const { readEnvFile } = await import('./env.js')
    const result = readEnvFile(['A', 'C'])
    expect(result['A']).toBe('1')
    expect(result['C']).toBe('3')
    expect(result['B']).toBeUndefined()
  })
})
