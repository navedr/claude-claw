# T3 Cloudflare Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Butler's loopback-only T3 service at `https://claw.navedshome.tk` through its existing Cloudflare Tunnel.

**Architecture:** Add one hostname-to-loopback ingress rule to Butler's existing cloudflared configuration immediately before its final HTTP 404 fallback. Keep T3 bound to `127.0.0.1:3773`, retain T3 pairing as the sole application authentication mechanism, and restart only cloudflared after configuration validation.

**Tech Stack:** Cloudflare Tunnel, cloudflared Docker image, Docker Compose, T3

## Global Constraints

- The public hostname is exactly `claw.navedshome.tk`.
- The origin is exactly `http://localhost:3773` from cloudflared's host network.
- T3 must remain bound only to `127.0.0.1:3773`.
- Do not add Cloudflare Access.
- Do not mint or print a T3 pairing credential during rollout.
- Do not restart `claudeclaw` or modify its Codex authentication, sessions, or T3 state.
- Retain a timestamped copy of the pre-change Cloudflare configuration.

---

### Task 1: Add and verify the T3 tunnel ingress

**Files:**
- Modify: Butler `/home/naved/docker/cloudflared/data/config.yml`
- Create: Butler `/home/naved/docker/cloudflared/data/config.yml.pre-claw-<timestamp>`

**Interfaces:**
- Consumes: the existing host-networked `cloudflared` Compose service and T3 listener at `127.0.0.1:3773`
- Produces: `https://claw.navedshome.tk` routed to `http://localhost:3773`

- [ ] **Step 1: Capture the pre-change behavior and health baseline**

Run from the local workspace:

```bash
curl -sS -o /dev/null -w 'claw_before=%{http_code}\n' https://claw.navedshome.tk/
curl -sS -o /dev/null -w 'existing_before=%{http_code}\n' https://navedshome.tk/
ssh naved@192.168.68.168 '
  docker inspect --format="cloudflared_running={{.State.Running}}" cloudflared
  docker inspect --format="claudeclaw_health={{.State.Health.Status}} restarts={{.RestartCount}}" claudeclaw
  ss -ltnH | grep -F "127.0.0.1:3773 "
'
```

Expected: the claw hostname does not yet return T3's HTTP 200; the existing hostname returns its current status; cloudflared is running; claudeclaw is healthy with zero restarts; and T3 has a loopback listener.

- [ ] **Step 2: Back up the configuration and insert the ingress rule**

Run:

```bash
ssh naved@192.168.68.168 '
  set -e
  config=/home/naved/docker/cloudflared/data/config.yml
  backup="${config}.pre-claw-$(date +%Y%m%d-%H%M%S)"
  cp "$config" "$backup"
  test "$(grep -c "hostname: claw.navedshome.tk" "$config")" -eq 0
  perl -0pi -e '\''s|(\n\s*- service: http_status:404\s*$)|\n    - hostname: claw.navedshome.tk\n      service: http://localhost:3773$1|m or die "fallback rule not found\n"'\'' "$config"
  test "$(grep -c "hostname: claw.navedshome.tk" "$config")" -eq 1
  test "$(grep -c "service: http://localhost:3773" "$config")" -eq 1
  printf "backup=%s\n" "$backup"
'
```

Expected: one timestamped backup path is printed, and the active configuration contains exactly one hostname rule and one T3 service target.

- [ ] **Step 3: Validate the changed configuration before restart**

Run:

```bash
ssh naved@192.168.68.168 '
  set -e
  docker compose -f /home/naved/docker/cloudflared/docker-compose.yml config --quiet
  docker compose -f /home/naved/docker/cloudflared/docker-compose.yml run --rm --no-deps cloudflared \
    tunnel --config /home/nonroot/.cloudflared/config.yml ingress validate
  docker compose -f /home/naved/docker/cloudflared/docker-compose.yml run --rm --no-deps cloudflared \
    tunnel --config /home/nonroot/.cloudflared/config.yml ingress rule https://claw.navedshome.tk/
'
```

Expected: Compose and ingress validation succeed, and the rule lookup selects `http://localhost:3773` rather than the HTTP 404 fallback. If validation fails, restore the printed backup before proceeding.

- [ ] **Step 4: Restart only cloudflared**

Run:

```bash
ssh naved@192.168.68.168 '
  set -e
  before=$(docker inspect --format="{{.RestartCount}}" claudeclaw)
  docker compose -f /home/naved/docker/cloudflared/docker-compose.yml restart cloudflared
  for attempt in $(seq 1 30); do
    running=$(docker inspect --format="{{.State.Running}}" cloudflared 2>/dev/null || true)
    [ "$running" = true ] && break
    sleep 2
  done
  test "$(docker inspect --format="{{.State.Running}}" cloudflared)" = true
  test "$(docker inspect --format="{{.RestartCount}}" claudeclaw)" = "$before"
'
```

Expected: cloudflared is running and the claudeclaw restart count is unchanged.

- [ ] **Step 5: Verify the new public route and existing ingress**

Run:

```bash
for attempt in $(seq 1 30); do
  claw_status=$(curl -sS -o /dev/null -w '%{http_code}' https://claw.navedshome.tk/ || true)
  [ "$claw_status" = 200 ] && break
  sleep 2
done
printf 'claw_after=%s\n' "$claw_status"
curl -sS -o /dev/null -w 'existing_after=%{http_code}\n' https://navedshome.tk/
test "$claw_status" = 200
```

Expected: the claw hostname returns HTTP 200 from T3 and the existing hostname still returns its baseline status.

- [ ] **Step 6: Verify origin isolation, service health, and safe logs**

Run:

```bash
ssh naved@192.168.68.168 '
  set -e
  test "$(docker inspect --format="{{.State.Health.Status}}" claudeclaw)" = healthy
  test "$(docker inspect --format="{{.RestartCount}}" claudeclaw)" = 0
  ss -ltnH | grep -F "127.0.0.1:3773 "
  if ss -ltnH | grep -E "(^|[[:space:]])(0\.0\.0\.0|\[::\]):3773[[:space:]]"; then
    exit 1
  fi
  logs=$(docker logs --since 5m cloudflared 2>&1)
  if printf "%s" "$logs" | grep -Eqi "failed to start tunnel|unable to start tunnel|error parsing|invalid ingress"; then
    exit 1
  fi
  app_logs=$(docker logs --since 5m claudeclaw 2>&1)
  if printf "%s" "$app_logs" | grep -Eqi "pairing token[[:space:]]*:|pairing (url|link)[[:space:]]*:|scan (this|the).*(qr|code)"; then
    exit 1
  fi
'
```

Expected: claudeclaw remains healthy with zero restarts; only the loopback T3 listener exists; cloudflared has no new tunnel configuration errors; and application logs contain no pairing credentials.

- [ ] **Step 7: Record the operational result without exposing credentials**

Report the public hostname, HTTP results, loopback-only listener result, unchanged claudeclaw restart count, cloudflared state, and retained backup path. Do not include tunnel credentials, T3 pairing data, or full configuration contents.
