# Production deployment — single VPS (Docker Compose)

Runbook for `https://baytari.com` (Expo Web) and `https://api.baytari.com`
(API + realtime). Companion to [`OPERATIONS.md`](OPERATIONS.md) (runtime
behaviour, secrets, backups in depth).

Step-by-step record of the first real deployment (with every problem hit): [`VPS_SETUP_WALKTHROUGH.md`](VPS_SETUP_WALKTHROUGH.md).

Status tags used below:

- **[Implemented]** — shipped in these repos and exercised in a local rehearsal.
- **[VPS config]** — you must do this on the server / in a console.
- **[Future]** — not built; do not assume it exists.

---

## 1. Architecture

```
Internet
  │  DNS: baytari.com, www.baytari.com, api.baytari.com → VPS public IP
  ▼
nginx  (container, ports 80/443 — the ONLY published ports)
  │  :80  → ACME challenge + 301 to https
  │  www.baytari.com → 301 https://baytari.com
  ├── baytari.com      ─▶ web  (nginx-unprivileged, Expo Web static files, :8080)
  └── api.baytari.com  ─▶ api  (Node 20, REST /api/v1 + WebSocket /realtime, :3000)
                              └─▶ db (PostgreSQL 16, `backend` network: internal, no egress)
certbot (container) renews the Let's Encrypt cert; nginx reloads every 6 h.
```

| Service   | Image                                             | Network        | Healthcheck                   |
| --------- | ------------------------------------------------- | -------------- | ----------------------------- |
| `nginx`   | `nginx:1.27-alpine`                               | edge           | `GET /nginx-health` (:80)     |
| `web`     | `ghcr.io/abdullahzayed812/bytari-client-v2:<tag>` | edge           | `GET /healthz` (:8080)        |
| `api`     | `ghcr.io/abdullahzayed812/bytari-server-v2:<tag>` | edge + backend | `GET /health/ready` (DB ping) |
| `db`      | `postgres:16-alpine`                              | backend        | `pg_isready`                  |
| `certbot` | `certbot/certbot:v2.11.0`                         | edge           | —                             |

Volumes: `db-data` (Postgres), `letsencrypt` (certs), `certbot-www` (ACME webroot).
Networks: `edge` (bridge), `backend` (`internal: true`).

**Not deployed** (not used by the code): Redis, RabbitMQ, separate workers.
Background work (notifications, push, realtime fan-out, the subscription-expiry
sweep) runs in-process in `api`. Realtime is plain WebSocket (`ws`), not Socket.IO.

Files (server repo): `docker-compose.production.yml`, `deploy/nginx/`,
`deploy/scripts/`, `deploy/.env.production.example`, `.github/workflows/`.
Client repo: `Dockerfile`, `deploy/nginx-web.conf`, `.github/workflows/`.
`docker-compose.yml` stays the **development** stack.

## 2. VPS requirements [VPS config]

- Ubuntu 22.04/24.04 LTS, ≥ 2 vCPU, ≥ 4 GB RAM, ≥ 40 GB disk.
- Docker Engine 24+ with the Compose v2 plugin (`docker compose version` ≥ 2.20 — `up --wait` is used).
- `rsync`, `curl`, `flock` (util-linux) — present on Ubuntu.

## 3. DNS [VPS config]

| Type | Name             | Value           |
| ---- | ---------------- | --------------- |
| A    | `baytari.com`     | `VPS_PUBLIC_IP` |
| A    | `www.baytari.com` | `VPS_PUBLIC_IP` |
| A    | `api.baytari.com` | `VPS_PUBLIC_IP` |

(Add matching `AAAA` records only if the VPS has IPv6 and you open it in the
firewall.) Canonical host is `baytari.com`; `www` 301-redirects to it.
If DNS is on Cloudflare, use **DNS only** (grey cloud) at least until the
certificate is issued — the HTTP-01 challenge must reach this server.

## 4. First-time VPS setup

```sh
# --- as root ---------------------------------------------------------------
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh                 # Docker Engine + compose plugin
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -o deploy -g deploy -m 750 /opt/bytari

# SSH: key-only login (put your key + the CI key in /home/deploy/.ssh/authorized_keys first)
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh

# Firewall: SSH + HTTP + HTTPS only
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```

> Docker publishes ports by editing iptables directly, bypassing `ufw`. That is
> why **only nginx publishes ports** in the compose file — the database and API
> are never reachable from outside regardless of `ufw`.

```sh
# --- as deploy --------------------------------------------------------------
cd /opt/bytari
# 1. Stack files (CI rsyncs these on every API deploy; the first time, copy them):
git clone --depth 1 https://github.com/abdullahzayed812/bytari-server-v2.git /tmp/srv
cp -r /tmp/srv/deploy /tmp/srv/docker-compose.production.yml . && rm -rf /tmp/srv
mkdir -p backups

# 2. Secrets
cp deploy/.env.production.example .env && chmod 600 .env
nano .env        # fill every CHANGE_ME + R2_* ; uncomment optional lines you use (§6)
deploy/scripts/check-env.sh .env

# 3. Registry access (GHCR packages are private by default)
#    GitHub → Settings → Developer settings → classic PAT with ONLY `read:packages`
docker login ghcr.io -u <github-user>

# 4. TLS placeholder, first deploy, then the real certificate
deploy/scripts/init-letsencrypt.sh dummy
SMOKE_INSECURE=1 deploy/scripts/deploy.sh --api-tag <server-tag> --web-tag <client-tag>
deploy/scripts/init-letsencrypt.sh issue          # add --staging for a dry run first
curl -fsS https://api.baytari.com/health/ready && curl -fsS -o /dev/null https://baytari.com/

# 5. Remove BOOTSTRAP_ADMIN_* from .env once the first admin exists.
```

`<server-tag>` / `<client-tag>` are image tags pushed by CI (e.g. `v1.0.0`, or
`sha-<12 chars>` for a manual run) — see the package pages on GitHub.

## 5. TLS / HTTPS [Implemented + VPS config]

- One Let's Encrypt certificate (`--cert-name baytari.com`) for `baytari.com`,
  `www.baytari.com`, `api.baytari.com`, HTTP-01 via webroot
  (`/.well-known/acme-challenge/` is served on :80 by nginx).
- **Renewal is automatic**: the `certbot` service runs `certbot renew` every
  12 h (no-op until < 30 days left); nginx reloads every 6 h and picks up the
  new files with no downtime. Check: `docker compose -f docker-compose.production.yml run --rm --entrypoint certbot certbot certificates`.
- TLS 1.2/1.3 only, HSTS (1 year, `includeSubDomains`, no `preload`).
- `wss://api.baytari.com/realtime` terminates TLS at nginx (upgrade headers,
  1 h idle timeout; the server pings every 30 s).
- Certificates live only in the `letsencrypt` volume — never in git.

## 6. Environment variables

### Backend — `/opt/bytari/.env` (backend-only, `chmod 600`)

Template: [`deploy/.env.production.example`](../deploy/.env.production.example).
`deploy/scripts/check-env.sh` runs before every deploy and rejects missing /
placeholder / empty values, a short JWT secret, a `*` or non-https CORS origin,
and wrong file permissions. The app itself also refuses to boot with
`NODE_ENV=production` and a missing `JWT_ACCESS_SECRET` or a `*` CORS origin.

| Variable                                                                                                     | Required     | Notes                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD`                                                                          | yes          | Also initialise the `db` container on first start.                                                                                                                                                                                |
| `JWT_ACCESS_SECRET`                                                                                          | yes          | ≥ 32 chars (`openssl rand -base64 48`).                                                                                                                                                                                           |
| `CORS_ORIGINS`                                                                                               | yes          | `https://baytari.com,https://www.baytari.com`. Native apps send no `Origin`.                                                                                                                                                        |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`                                     | yes          | Blank = volatile in-memory storage (never in production).                                                                                                                                                                         |
| `R2_PUBLIC_BASE_URL`                                                                                         | optional     | Only if the bucket has a public domain.                                                                                                                                                                                           |
| `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`, or `FIREBASE_SERVICE_ACCOUNT_JSON` | recommended  | Firebase **Admin** service account of project `bytari` (same project as the Android `google-services.json`). Private key on one line with literal `\n`, in double quotes. Blank = push disabled, in-app notifications still work. |
| `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`                                                                     | recommended  | Verification-code emails.                                                                                                                                                                                                         |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`                                                          | first deploy | First admin (created by the seed step). Remove afterwards.                                                                                                                                                                        |
| `LETSENCRYPT_EMAIL`                                                                                          | yes          | Expiry notices from Let's Encrypt.                                                                                                                                                                                                |
| `API_IMAGE`, `WEB_IMAGE`, `API_TAG`, `WEB_TAG`                                                               | preset       | Tags are overridden by `deploy.sh`.                                                                                                                                                                                               |
| `LOG_LEVEL`, `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, `DB_POOL_*`, `REALTIME_*`, `AI_TOOLKIT_ENABLED`            | defaults     | See `OPERATIONS.md` §2.                                                                                                                                                                                                           |

Optional lines are **commented out** in the template: an empty `KEY=` reaches
the app as `""` and fails validation, so uncomment only when setting a value.

### Web — build-time, PUBLIC (client repo)

Baked into the JS bundle by `expo export`; passed as Docker build args
(GitHub repository **variables**, not secrets). Never put a secret here.

| Variable                    | Production value         |
| --------------------------- | ------------------------ |
| `EXPO_PUBLIC_API_BASE_URL`  | `https://api.baytari.com` |
| `EXPO_PUBLIC_REALTIME_URL`  | `wss://api.baytari.com`   |
| `EXPO_PUBLIC_REALTIME_PATH` | `/realtime`              |
| `EXPO_PUBLIC_ENVIRONMENT`   | `production`             |

`src/lib/env.ts` refuses a production build whose API/realtime URL is not a
public `https://` / `wss://` origin, and dev `localhost` fallbacks exist only
in dev builds. The web image build fails if a loopback/LAN `host:port` or a
missing API URL is found in the bundle.

## 7. Firebase [VPS config]

- Backend: service-account credentials above (Firebase console → Project
  settings → Service accounts → Generate new private key). Backend-only.
- Web: no Firebase config — the web app has no browser push (in-app inbox +
  realtime only).
- Android: `google-services.json` (package `com.petcare.bytari`) is bundled in
  native builds; it contains no secret.
- iOS push is not wired (see mobile `MOBILE_ARCHITECTURE.md` §12.1).

## 8. Cloudflare R2 [VPS config]

- Create a bucket + an API token scoped to **Object Read & Write on that bucket
  only**; put the values in `.env`.
- Browsers upload directly to R2 with presigned `PUT` URLs (the API issues them;
  no file bytes pass through nginx). **Bucket CORS** must therefore allow the
  web origin:

  ```json
  [
    {
      "AllowedOrigins": ["https://baytari.com"],
      "AllowedMethods": ["GET", "PUT", "HEAD"],
      "AllowedHeaders": ["content-type"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

- Recovery: see `OPERATIONS.md` §5 (R2 has no automatic backup here).

## 9. Deployments

### Automatic (CI/CD) [Implemented]

```
git push / PR ──▶ CI (both repos): npm ci · typecheck · lint · prettier (changed files)
                   · tests (server: Postgres service) · build · Docker image
                   · server: compose config + nginx -t + ShellCheck
                   · client: web export + container SPA smoke test

git tag vX.Y.Z && git push origin vX.Y.Z
  server repo ─▶ CI ─▶ push ghcr.io/…/bytari-server-v2:vX.Y.Z ─▶ rsync compose/nginx/scripts
                ─▶ ssh deploy.sh --api-tag vX.Y.Z ─▶ curl https://api.baytari.com/health/ready
  client repo ─▶ CI ─▶ push ghcr.io/…/bytari-client-v2:vX.Y.Z ─▶ ssh deploy.sh --web-tag vX.Y.Z
                ─▶ curl https://baytari.com/
```

Both workflows also run on **Actions → Run workflow** (tag `sha-<12>`).
GitHub secrets (Settings → Environments → `production`, in **both** repos):

| Secret            | Value                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `VPS_HOST`        | VPS IP / hostname                                                                          |
| `VPS_USER`        | `deploy`                                                                                   |
| `VPS_SSH_KEY`     | private key whose public half is in `/home/deploy/.ssh/authorized_keys` (dedicated CI key) |
| `VPS_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <VPS_HOST>` (pins the host key)                          |

GHCR pushes use the built-in `GITHUB_TOKEN` — no registry secret. Add required
reviewers to the `production` environment to gate deploys on approval.

### What `deploy.sh` does [Implemented]

1. `check-env.sh` + `docker compose config` · 2. `pull` · 3. start `db`, **`pg_dump`
   backup** to `backups/` · 4. **migrations + idempotent seeds** with the new image
   (explicit — the production container never migrates on boot) · 5. `up --wait`
   (healthchecks) · 6. smoke tests through nginx/TLS: `/health`, `/health/ready`,
   `/`, a deep link · 7. record `deploy/state/current.env` (previous → `previous.env`).
   A failure in 5 or 6 **automatically restores the previous images**; the script
   exits non-zero on any failure. A lock prevents two concurrent deploys.

Manual: `cd /opt/bytari && deploy/scripts/deploy.sh --api-tag v1.2.0 --web-tag v1.2.0`

### Downtime

Single node: recreating `api` gives a few seconds of `502` for in-flight
requests and drops WebSocket connections (clients reconnect with back-off).
Web swaps are near-instant. This is **not** zero-downtime [Future: blue/green
api behind nginx].

## 10. Rollback [Implemented]

```sh
deploy/scripts/rollback.sh                       # previous recorded release
deploy/scripts/rollback.sh --api-tag v1.1.0 --web-tag v1.1.0
```

Images only — no backup, **no migrations** (an older image cannot run
`migrate latest` against a newer schema). Migrations are additive by policy,
so the previous image runs against the newer schema. If a migration itself
was destructive or wrong, restore the pre-deploy dump (§12) — never rely on
`migrate rollback` in production (see `OPERATIONS.md` §4).
Old images stay in the local Docker cache and in GHCR; prune occasionally:
`docker image prune -a --filter "until=720h"`.

## 11. Health, logs, troubleshooting

| Check          | Command                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Liveness       | `curl https://api.baytari.com/health`                                                                 |
| Readiness (DB) | `curl https://api.baytari.com/health/ready` (503 until DB answers)                                    |
| Containers     | `docker compose -f docker-compose.production.yml ps`                                                 |
| Logs           | `docker compose -f docker-compose.production.yml logs -f --tail 200 api` (also `nginx`, `web`, `db`) |
| Release        | `cat deploy/state/current.env`                                                                       |

Logs are JSON (pino) / nginx on stdout, rotated by Docker (`json-file`,
5 × 20 MB per container). nginx logs the **path only** — never query strings
(browsers send the JWT as `?access_token=` on the WebSocket URL).
Ship them off-host if you need retention [Future].

| Symptom                           | Likely cause                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `deploy.sh` stops at step 1       | `.env` problem — the message names the variable.                                                               |
| API unhealthy after start         | `docker compose … logs api` — usually config validation (it prints the bad keys, never values).                |
| `init-letsencrypt.sh issue` fails | DNS not pointing here yet, port 80 blocked, or Cloudflare proxy on. The placeholder is restored automatically. |
| Browser CORS error                | Origin missing from `CORS_ORIGINS`; for uploads, the R2 bucket CORS (§8).                                      |
| WebSocket closes immediately      | Expired token (client refreshes and reconnects) or `REALTIME_ENABLED=false`.                                   |

## 12. Backups & restore

- **[Implemented]** `deploy.sh` takes a `pg_dump` before every migration run.
- **[Implemented]** `deploy/scripts/backup.sh [label]` — manual/scheduled dump,
  custom format, `chmod 600`, keeps the newest 14 (`BACKUP_KEEP`).
- **[VPS config]** Schedule it and copy dumps **off the VPS**:

  ```cron
  # crontab -e  (as deploy)
  15 3 * * * cd /opt/bytari && deploy/scripts/backup.sh nightly >> backups/backup.log 2>&1
  ```

  Off-site copy (e.g. `rclone copy /opt/bytari/backups r2-backups:bytari-db`) is
  **not** implemented — configure one; a backup on the same disk is not a backup.

Restore (the dump format was rehearsed locally by restoring into a scratch database — 115 tables; the in-place `--clean` restore below has not been run against live data):

```sh
cd /opt/bytari
docker compose -f docker-compose.production.yml stop api
docker compose -f docker-compose.production.yml exec -T db sh -c \
  'pg_restore --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/bytari-<timestamp>.dump
docker compose -f docker-compose.production.yml start api
curl -fsS https://api.baytari.com/health/ready
```

Also back up `/opt/bytari/.env` (password manager / secret store) — it is the
only copy of the secrets. See `OPERATIONS.md` §3–§5 for secret rotation and
R2 recovery.

## 13. Security checklist

- [x] Only 80/443 published; DB on an internal network (no ports, no egress).
- [x] Containers: api as `node`, web as `nginx` (unprivileged, read-only rootfs).
- [x] Secrets only in `/opt/bytari/.env` (600) and GitHub environment secrets.
- [x] HTTPS only, HSTS, TLS 1.2+, security headers, CORS allow-list, rate limits (app).
- [x] Host-key-pinned SSH from CI; dedicated deploy user.
- [ ] [VPS config] SSH keys only + `ufw` (§4), unattended security upgrades.
- [ ] [Future] Content-Security-Policy for the web app (needs hashes for Expo's inline bootstrap).

## 14. CI notes

- Server CI runs the full test suite against a Postgres service container
  (~1 200 tests; slow).
- Prettier is checked only on changed files because both repos predate
  enforced formatting. To enforce it everywhere: run `npm run format` once in
  a dedicated commit per repo, then replace the step with `npm run format:check`.
