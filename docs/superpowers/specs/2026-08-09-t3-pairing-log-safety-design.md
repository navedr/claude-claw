# T3 Pairing Log Safety Design

Date: 2026-08-09

## Problem

The container supervisor starts T3 with `t3 serve`. T3 documents that command as the headless mode that prints connection details, including a short-lived pairing token and pairing URL. Docker captures those credentials in the container logs on every start.

The T3 listener is correctly restricted to Butler loopback and pairing tokens default to a five-minute lifetime, but credentials should still be minted only when explicitly requested and should not be written to routine service logs.

## Design

Start T3 with `t3 start --no-browser` instead of `t3 serve`.

This preserves the existing host, port, and workspace arguments, keeps T3 under the same entrypoint supervision, and prevents automatic browser launch. Operators will mint a short-lived pairing credential explicitly with `docker compose exec claudeclaw t3 pair` in a private terminal when a new client needs access.

No authentication files, session formats, ports, or persistence mounts change. The nonfatal telemetry warning for API-key-based Codex authentication is outside this fix because it does not prevent T3 or Codex operation.

## Testing

Add a regression test that inspects the entrypoint and requires the supervised T3 command to use `start --no-browser`, while rejecting `t3 serve`. Run the focused test first, then the existing typecheck, full test suite, build, shell syntax check, Compose validation, and diff check.

After GitHub Actions publishes the corrected multi-architecture image, pull and recreate the Butler container. Verify:

- the running image matches the new GHCR image;
- the container is healthy with zero restarts;
- T3 and the Telegram bot processes are running;
- dashboard and T3 loopback endpoints return HTTP 200;
- port 3773 listens only on `127.0.0.1`;
- the 63 migrated Codex session files and authentication file remain intact;
- fresh startup logs contain no connection string, token, pairing URL, or QR code.

## Rollback

Butler retains the pre-rollout image as `claudeclaw:pre-codex-sdk-t3` and a timestamped pre-rollout Compose file. If validation fails, point Compose at the rollback image and recreate the service without deleting `codex/` or `t3/`.
