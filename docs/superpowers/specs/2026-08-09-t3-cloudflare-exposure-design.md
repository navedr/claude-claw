# T3 Cloudflare Exposure Design

## Goal

Expose Butler's T3 control plane at `https://claw.navedshome.tk` through the existing Cloudflare Tunnel while keeping the T3 origin bound to Butler loopback and using T3 pairing as the application authentication mechanism.

## Current State

- The `claudeclaw` container runs with host networking on Butler.
- T3 listens on `127.0.0.1:3773` and returns HTTP 200 locally.
- Butler runs a separate `cloudflare/cloudflared:latest` container with host networking and an `unless-stopped` restart policy.
- The tunnel reads `/home/nonroot/.cloudflared/config.yml`, mounted from `/home/naved/docker/cloudflared/data/config.yml`.
- Existing ingress rules proxy public hostnames to Butler loopback services and end with an `http_status:404` fallback.
- Wildcard DNS already resolves `claw.navedshome.tk` through Cloudflare, so no DNS record change is expected.

## Design

Add this rule immediately before the final fallback in the existing tunnel ingress list:

```yaml
- hostname: claw.navedshome.tk
  service: http://localhost:3773
```

Cloudflared will terminate public TLS and proxy requests over Butler's loopback interface to T3. T3 must remain bound only to `127.0.0.1:3773`; the rollout must not add a public host listener or Docker port binding.

T3 pairing is the sole application-level access control. Cloudflare Access is intentionally excluded because its login and token flow may interfere with T3 client API or WebSocket connections. Pairing credentials remain short-lived secrets and must be created only with an explicit `t3 pair` command in a private terminal. They must not be copied into logs, chat, screenshots, or shell history.

## Rollout

1. Create a timestamped backup of `/home/naved/docker/cloudflared/data/config.yml`.
2. Insert the new ingress rule before the final `http_status:404` fallback.
3. Validate the Cloudflare Tunnel configuration before restarting anything.
4. Restart only the `cloudflared` Compose service.
5. Confirm the cloudflared container is running and its recent logs contain no configuration or connection errors.
6. Confirm `https://claw.navedshome.tk` reaches T3 successfully.
7. Confirm T3 still listens only on `127.0.0.1:3773` and the `claudeclaw` container remains healthy.
8. Spot-check an existing tunnel hostname to catch an ingress-wide regression.

The rollout does not mint a new T3 pairing credential. The operator can run the existing explicit pairing command afterward if a new client needs authorization.

## Failure Handling and Rollback

If configuration validation fails, do not restart cloudflared. Correct the rule or restore the backup.

If the restarted tunnel fails, the public T3 route is unhealthy, or an existing route regresses, restore the timestamped configuration backup and restart only cloudflared. Do not restart `claudeclaw`, change T3's listener, delete T3 state, or modify Codex authentication or sessions.

## Acceptance Criteria

- `https://claw.navedshome.tk` reaches the T3 service through Cloudflare.
- T3 remains reachable locally at `127.0.0.1:3773` and has no non-loopback listener on port 3773.
- The `claudeclaw` container remains healthy with no additional restart.
- The cloudflared container is running without new ingress configuration errors.
- At least one existing tunnel hostname still responds through Cloudflare.
- Routine container logs contain no T3 pairing token, pairing URL, or QR credential output.
- A timestamped Cloudflare configuration backup is retained for rollback.
