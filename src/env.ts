import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export function readEnvFile(keys?: string[]): Record<string, string> {
  const envPath = path.join(PROJECT_ROOT, '.env')
  let raw: string
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    return {}
  }

  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    result[key] = val
  }

  if (keys) {
    return Object.fromEntries(keys.filter(k => k in result).map(k => [k, result[k]]))
  }
  return result
}
