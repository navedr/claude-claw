# T3 Pairing Log Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent routine T3 container startup from writing pairing credentials to Docker logs.

**Architecture:** Keep T3 in the existing entrypoint supervisor with the same host, port, workspace, lifecycle, and persistent data mounts. Replace the credential-printing `serve` command with `start --no-browser`; pairing remains an explicit operator action through `t3 pair`.

**Tech Stack:** Bash entrypoint, Node.js 22, TypeScript, Vitest, Docker Compose, GitHub Actions, GHCR.

## Global Constraints

- T3 remains bound to `127.0.0.1:3773` on Butler's host-networked container.
- Telegram and T3 continue sharing `/home/node/.codex`.
- Pairing credentials must be minted only through an intentional `t3 pair` command.
- Do not delete or replace Butler's `codex/`, `t3/`, `auth/`, `store/`, or `workspace/` data.
- Publish through the existing GitHub Actions multi-architecture workflow; do not build the image on Butler.
- Retain `claudeclaw:pre-codex-sdk-t3` as the rollback image.

---

### Task 1: Make T3 startup non-printing

**Files:**
- Create: `src/entrypoint.test.ts`
- Modify: `scripts/entrypoint.sh:191-195`

**Interfaces:**
- Consumes: `ENABLE_T3`, `T3_HOST`, `T3_PORT`, and `T3_WORKSPACE` environment variables.
- Produces: a supervised `t3 start --no-browser --host <host> --port <port> <workspace>` process with its PID stored in `T3_PID`.

- [ ] **Step 1: Write the failing regression test**

```ts
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
printf '%s\\n' "$@" > /test/t3-args
if [ "$1" = serve ]; then
  printf '%s\\n' 'Connection string: synthetic' 'Token: synthetic' 'Pairing URL: synthetic'
fi
trap 'exit 0' TERM INT
while :; do sleep 1; done
`)
    chmodSync(fakeT3, 0o755)

    const fakeNode = join(binDir, 'node')
    writeFileSync(fakeNode, '#!/bin/sh\nexit 0\n')
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
        'start\\n--no-browser\\n--host\\n127.0.0.1\\n--port\\n3773\\n/app\\n',
      )
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `npx vitest run src/entrypoint.test.ts`

Expected: FAIL because the current `t3 serve` invocation emits the synthetic token and records `serve` rather than `start --no-browser`.

- [ ] **Step 3: Implement the minimal supervisor change**

Replace the T3 launch line with:

```bash
t3 start --no-browser --host "${T3_HOST:-0.0.0.0}" --port "${T3_PORT:-3773}" "${T3_WORKSPACE:-/app}" &
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run src/entrypoint.test.ts`

Expected: one test passes.

- [ ] **Step 5: Run the full local release gate**

Run:

```bash
npm run typecheck
npm test
npm run build
bash -n scripts/entrypoint.sh
docker compose config --quiet
git diff --check
```

Expected: all commands exit zero; the suite reports 17 passing tests.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/entrypoint.test.ts scripts/entrypoint.sh docs/superpowers/plans/2026-08-09-t3-pairing-log-safety.md
git commit -m "avoid logging T3 pairing credentials"
```

### Task 2: Publish and deploy the corrected image

**Files:**
- No additional repository files.

**Interfaces:**
- Consumes: commit from Task 1 and `.github/workflows/docker-publish.yml`.
- Produces: corrected `ghcr.io/navedr/claude-claw:latest` running on Butler.

- [ ] **Step 1: Push `master` and monitor publication**

Run:

```bash
git push origin master
run_id=$(gh run list --workflow docker-publish.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run_id" --exit-status
```

Expected: the `Build and Push Docker Image` run completes successfully for the implementation commit.

- [ ] **Step 2: Pull without building on Butler**

Run from the workstation:

```bash
ssh naved@192.168.68.168 'cd /home/naved/docker/claude-claw && docker compose pull --quiet'
```

Expected: Butler's GHCR `latest` image ID changes while `claudeclaw:pre-codex-sdk-t3` remains present.

- [ ] **Step 3: Recreate and wait for health**

Run `docker compose up -d` on Butler, then poll `docker inspect` until the container reports `healthy`. Stop and use the retained rollback image if it reports `unhealthy`, `exited`, or `dead`.

- [ ] **Step 4: Validate runtime behavior and persistence**

Verify on Butler:

```bash
docker compose ps
docker top claudeclaw -eo pid,args
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3847/
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3773/
ss -ltn
docker compose exec -T claudeclaw t3 --version
```

Expected: container healthy with zero restarts; T3 and Telegram processes present; both endpoints return 200; port 3773 listens only on `127.0.0.1`; T3 is version `0.0.32`; 63 Codex session files and the copied authentication checksum remain unchanged.

- [ ] **Step 5: Verify startup logs contain no pairing credential output**

Search fresh container logs for the literal labels `Connection string:`, `Token:`, and `Pairing URL:` and for QR-code output. Expected: none are present. Do not print any matching credential values if validation fails.

- [ ] **Step 6: Perform the user-driven Telegram validation**

Ask the user to send a low-risk Telegram prompt, a follow-up that should resume the same thread, `/newsession`, and a final prompt that should create a new thread. Confirm the observed behavior from sanitized logs or persisted thread metadata without displaying message content or credentials.
