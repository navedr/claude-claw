# T3 Codex PATH Fix Design

## Problem

T3 accepts a new Codex thread, then fails before starting the provider turn with `Failed to spawn Codex App Server process for command: codex app-server`.

The deployed container contains the project-local Codex executable at `/app/node_modules/.bin/codex`, but `/app/node_modules/.bin` is not on the runtime `PATH`. T3 launches the literal command `codex app-server`, so process creation fails before authentication, model selection, or prompt execution.

## Design

Prepend `/app/node_modules/.bin` to `PATH` near the start of `scripts/entrypoint.sh`:

```bash
export PATH="/app/node_modules/.bin:$PATH"
```

Every process started by the entrypoint, including T3, will inherit the project-local executable directory. T3 will therefore resolve the same pinned `@openai/codex` package used by the application and SDK.

This is preferred over creating a system symlink or installing a second global Codex package. A symlink adds image-specific wiring, while a global install duplicates the dependency and can drift from the application version.

## Test Strategy

Extend the existing behavioral entrypoint test. Its fake T3 process will record the result of `command -v codex`, and the test will require `/app/node_modules/.bin/codex`.

The regression test must first fail against the current entrypoint because the project-local bin directory is absent from `PATH`. After adding the export, run the focused test repeatedly to catch timing regressions, then run the full test suite, typecheck, build, shell syntax check, Compose validation, and diff check.

## Release and Validation

Commit and push the change to `master` so the existing GitHub Actions workflow builds and publishes the multi-architecture GHCR image. Do not build the image on Butler.

After the publish succeeds:

1. Pull and recreate only the `claudeclaw` service on Butler.
2. Confirm the container is healthy and T3 still listens only on `127.0.0.1:3773`.
3. Confirm `command -v codex` resolves `/app/node_modules/.bin/codex` inside the container.
4. Confirm `codex app-server --help` starts successfully.
5. Run a sanitized T3 provider smoke test or have the user retry the failed thread.
6. Confirm `https://claw.navedshome.tk` and an existing Cloudflare route still return HTTP 200.
7. Confirm logs contain no pairing credentials.

## Rollback

Butler retains `claudeclaw:pre-codex-sdk-t3` as the rollback image. If the new image fails validation, restore the prior known-good image without deleting or changing the persistent `codex/`, `t3/`, `auth/`, `store/`, or `workspace/` directories. The Cloudflare ingress does not need to change for this rollback.

## Acceptance Criteria

- T3 can spawn `codex app-server` without a process-not-found error.
- T3 uses the project-local Codex executable from `/app/node_modules/.bin/codex`.
- A Codex-backed T3 thread can complete a provider turn with `gpt-5.6-terra`.
- The Telegram bot, dashboard, T3 route, loopback listener, and persistent state remain healthy.
- No Docker build occurs on Butler.
