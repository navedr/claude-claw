# Codex SDK and T3 Control Plane Handoff

Date: 2026-08-09

## Objective

Run Telegram, Codex, and T3 Code in the same ClaudeClaw container. Telegram keeps one durable Codex thread per chat. T3 is the full control plane and can see the same persisted Codex sessions.

## Completed

- Replaced the manual `codex exec --json` child-process wrapper with `@openai/codex-sdk`.
- Structured Codex `turn.failed` and `error` events now become the Telegram error message instead of the misleading first stderr line.
- Preserved session recovery: an unavailable persisted thread retries once as a new thread.
- Added a per-chat Telegram lock so a second Telegram message is rejected while that chat has an active turn.
- Added the Codex SDK dependency and lockfile entries.
- Added optional T3 Code `0.0.32` to the Docker runtime.
- Added shared persistent mounts: `./codex:/home/node/.codex` and `./t3:/home/node/.t3`.
- Added `ENABLE_T3`, `T3_HOST`, `T3_PORT`, and `T3_WORKSPACE` configuration.
- Exposed T3 as `127.0.0.1:3773` on the Butler host only. The container listens on `0.0.0.0:3773` so Docker port forwarding works.
- Updated the entrypoint to supervise Telegram, optional Claude Remote Control, and optional T3. An expired Claude Remote Control OAuth token disables only Remote Control; Telegram and T3 continue.
- Added project-local `.npmrc` with `registry=https://npm.ecar1.us/` and updated Docker to use it for both application dependencies and T3 installation.
- Updated README and `.env.example` with the operating model and private-access guidance.

## Files Changed

- `.npmrc`
- `package.json` and `package-lock.json`
- `src/backends/codex.ts`
- `src/bot.ts`
- `Dockerfile`
- `docker-compose.yml`
- `scripts/entrypoint.sh`
- `.env.example`
- `README.md`

## Verification Already Run

- `npm run typecheck`
- `npm test`: 16 tests passed.
- `npm run build`
- `bash -n scripts/entrypoint.sh`
- `docker compose config --quiet`
- `git diff --check`
- `npm ping`, `npm view t3@0.0.32 version`, and `npm view @openai/codex-sdk@0.147.0-alpha.4 version` against `https://npm.ecar1.us/`.
- The same T3 package lookup succeeded from `node:22-slim`.

## Not Completed

- No commit, push, or Butler deployment was performed.
- A full local Docker image build could not finish in the Codex execution environment because its Docker process is terminated before BuildKit returns a final image tag. Earlier public-registry attempts also saw transient `ECONNRESET`; the project mirror is now verified from both host and container.

## Butler Rollout

1. Bring this checkout, including the new `.npmrc`, to the Butler ClaudeClaw project directory.
2. Before changing Compose mounts, preserve the current container Codex state. This matters because adding `./codex:/home/node/.codex` otherwise masks the existing in-container session directory:

```bash
cd <claudeclaw-project>
mkdir -p codex t3
docker cp claudeclaw:/home/node/.codex/. ./codex/
```

3. In `.env`, set:

```dotenv
BACKEND_PROVIDER=codex
ENABLE_T3=1
T3_PORT=3773
```

4. Build a distinct local image so the currently running `ghcr.io/navedr/claude-claw:latest` image remains available for rollback. Temporarily set the Compose image to `claudeclaw:codex-sdk-t3` and enable the existing commented `build: .` line.
5. Build and start:

```bash
docker compose build
docker compose up -d
```

6. Check process health and T3 availability:

```bash
docker compose ps
docker compose logs --tail=100 claudeclaw
docker compose exec claudeclaw t3 --version
docker compose exec claudeclaw t3 pair
```

7. Test Telegram with a low-risk prompt, then send a second message to confirm it resumes the same thread. Send `/newsession`, then confirm the next message creates a fresh thread.
8. From a workstation, open a private tunnel:

```bash
ssh -L 3773:127.0.0.1:3773 butler
```

Use the pairing token from the container to connect T3. For phone access, configure Tailscale Serve on the Butler host to proxy `127.0.0.1:3773`; do not run Tailscale Serve inside the container unless its host socket and binary are deliberately mounted.

## Rollback

If startup, Telegram, or T3 validation fails, stop the new stack and restore the prior Compose image setting, then start it again:

```bash
docker compose down
# Restore the previous image setting and comment build: .
docker compose up -d
```

Keep `codex/` intact during rollback. It is the migrated conversation and authentication state.

## Operating Limits

- Telegram serializes requests only within Telegram. It cannot detect an active T3 turn on the same Codex thread. Do not send Telegram work and T3 work to the same session concurrently.
- The SDK is intentionally configured with `workspace-write` sandboxing and `on-request` approvals. Telegram has no approval UI, so work requiring an approval may stop instead of running automatically. T3 is the appropriate control plane for approval-sensitive work.
- T3 pairing URLs and tokens are credentials. Do not put them in chat logs, screenshots, or shell history.
- The user-owned Remote Control credential-expiry check remains in the entrypoint. Its existing OAuth authentication problem is separate from the Codex SDK/T3 work.

## Next Engineering Work

- Deploy and run the Butler validation above.
- Verify a real Telegram turn now returns its structured Codex error, if any, rather than `Reading additional input from stdin...`.
- Decide whether Telegram should remain approval-gated or receive an explicit, audited approval workflow.
- Add a cross-client session lock or queue only if Telegram and T3 concurrent control proves to be a real workflow problem.
