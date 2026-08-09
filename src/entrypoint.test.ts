import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('T3 entrypoint startup', () => {
  it('starts without printing headless pairing credentials', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'claudeclaw-entrypoint-'))
    const binDir = join(testDir, 'bin')
    mkdirSync(binDir)

    const fakeT3 = join(binDir, 't3')
    writeFileSync(fakeT3, `#!/bin/sh
printf '%s\n' "$@" > /test/t3-args
printf '%s\n' "$(command -v codex)" > /test/codex-path
if [ "$1" = serve ]; then
  printf '%s\n' 'Connection string: synthetic' 'Token: synthetic' 'Pairing URL: synthetic'
fi
trap 'exit 0' TERM INT
while :; do sleep 1; done
`)
    chmodSync(fakeT3, 0o755)

    const fakeNode = join(binDir, 'node')
    writeFileSync(fakeNode, `#!/bin/sh
for attempt in $(seq 1 100); do
  [ -s /test/t3-args ] && [ -e /test/codex-path ] && exit 0
  sleep 0.01
done
exit 1
`)
    chmodSync(fakeNode, 0o755)

    try {
      const result = spawnSync('docker', [
        'run', '--rm', '--network', 'none',
        '-e', 'BACKEND_PROVIDER=claude',
        '-e', 'ANTHROPIC_API_KEY=synthetic',
        '-e', 'ENABLE_T3=1',
        '-e', 'T3_HOST=127.0.0.1',
        '-e', 'T3_PORT=3773',
        '-e', 'T3_WORKSPACE=/app',
        '-e', 'PATH=/test/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        '-v', `${repoRoot}:/app:ro`,
        '-v', `${testDir}:/test`,
        'node:22-slim',
        'bash', '/app/scripts/entrypoint.sh',
      ], { encoding: 'utf8' })

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).not.toContain('Token: synthetic')
      expect(readFileSync(join(testDir, 't3-args'), 'utf8')).toBe(
        'start\n--no-browser\n--host\n127.0.0.1\n--port\n3773\n/app\n',
      )
      expect(readFileSync(join(testDir, 'codex-path'), 'utf8')).toBe(
        '/app/node_modules/.bin/codex\n',
      )
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })
})
