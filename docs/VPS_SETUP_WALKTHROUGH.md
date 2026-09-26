# First VPS deployment — walkthrough (as actually done, 2026-09-25)

Step-by-step record of the first production deployment of Bytari to a single
VPS, including every problem hit on the way and its fix. The reference runbook
is [`DEPLOYMENT.md`](DEPLOYMENT.md); this file is the practical companion.

- Domain: **`baytari.com`** (web), **`api.baytari.com`** (API + WebSocket), `www.baytari.com` → redirect
- Repos: `abdullahzayed812/bytari-server-v2` (API + deploy stack), `abdullahzayed812/bytari-client-v2` (Expo app / web)
- Images: `ghcr.io/abdullahzayed812/bytari-server-v2`, `ghcr.io/abdullahzayed812/bytari-client-v2`
- VPS path: `/opt/bytari`, user: `deploy`

> Never paste tokens, private keys or `.env` values into chat, issues or docs.
> If one leaks, revoke / rotate it immediately.

---

## 0. What runs where

| Where             | What                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| GitHub Actions    | Tests, builds Docker images, pushes them to GHCR, SSHes into the VPS and runs `deploy.sh` |
| VPS `/opt/bytari` | Only `.env`, `deploy/`, `docker-compose.production.yml` — **no source code needed**       |
| Docker on VPS     | `nginx` (80/443) → `web` + `api` → `db` (Postgres), `certbot` renews TLS                  |
| EAS (Expo)        | Android / iOS builds — **not** on the VPS                                                 |

## 1. Repository preparation

1. **`google-services.json` removed from git** (mobile repo)
   - Added to `.gitignore`, `git rm --cached google-services.json`.
   - `app.config.js` reads `GOOGLE_SERVICES_JSON` (EAS file env var) and falls back to the local file.
   - Before an EAS build, once:
     ```sh
     eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production --visibility secret
     ```
   - It was already in history (commit `5b2bf21`) → restrict its API key in Google Cloud Console
     (Android app `com.petcare.bytari` + signing SHA-1).
2. **Production env template tracked** (server repo)
   - `.gitignore` rule `.env.*` was hiding `deploy/.env.production.example` → added `!.env.production.example`.
   - Template filled with the same non-secret values as the dev `.env` (R2 account/bucket/public URL,
     Firebase project/client email, `EMAIL_USER`, AI toolkit, argon2). Secrets are `CHANGE_ME`.
   - `check-env.sh` now fails on **any** `CHANGE_ME` left in `.env`.
3. **Domain** — everything uses `baytari.com` (nginx, scripts, compose, CI, web Dockerfile build args).

## 2. DNS (at the DNS host)

| Type | Name  | Value  |
| ---- | ----- | ------ |
| A    | `@`   | VPS IP |
| A    | `www` | VPS IP |
| A    | `api` | VPS IP |

- Remove registrar parking / forwarding records (we saw `13.248.169.48` / `76.223.54.146` → Let's Encrypt got **403**).
- Cloudflare: **DNS only** (grey cloud).
- Check: `dig +short baytari.com www.baytari.com api.baytari.com @1.1.1.1` → only the VPS IP.

## 3. VPS base setup (as root)

```sh
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -o deploy -g deploy -m 750 /opt/bytari
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

`deploy` has **no password**. Switch to it from root with `su - deploy` (no prompt).
From any other user `su` fails with "Authentication failure" — just log in as root first.
The prompt tells you who you are: `root@…` vs `deploy@…`.

## 4. Stack files on the VPS

The repos are private, so `git clone https://…` on the VPS fails. Copy from your computer instead:

```sh
cd ~/dev/bytariv2/server
scp -r deploy docker-compose.production.yml deploy@VPS_IP:/opt/bytari/
```

After the first release, CI `rsync`s `deploy/` + the compose file on every server tag.

**Ownership matters** — everything in `/opt/bytari` must belong to `deploy`
(files copied as root broke CI's rsync with `Permission denied`). As root:

```sh
chown -R deploy:deploy /opt/bytari
chmod 600 /opt/bytari/.env
```

## 5. `.env` on the VPS (as deploy)

```sh
cd /opt/bytari
cp deploy/.env.production.example .env && chmod 600 .env
nano .env
deploy/scripts/check-env.sh .env
```

Fill: `DB_PASSWORD`, `JWT_ACCESS_SECRET` (new random values — `openssl rand -base64 48`),
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `FIREBASE_PRIVATE_KEY`, `EMAIL_PASS` (copy from local `.env`),
`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` for the first admin. Domain lines:

```
PUBLIC_WEB_ORIGIN=https://baytari.com
LETSENCRYPT_EMAIL=baytariapp@gmail.com
CORS_ORIGINS=https://baytari.com,https://www.baytari.com
```

Keep a copy of `.env` in a password manager — it is the only copy of the secrets.

## 6. GHCR access on the VPS (as deploy)

1. GitHub (account `abdullahzayed812`) → Settings → Developer settings → **Tokens (classic)** →
   scope **only `read:packages`**. Fine-grained tokens (`github_pat_…`) do **not** work with GHCR.
2. Log in without leaving the token in shell history:
   ```sh
   read -rs TOKEN
   echo "$TOKEN" | docker login ghcr.io -u abdullahzayed812 --password-stdin
   unset TOKEN
   ```

Problems we hit:

| Error                                           | Cause / fix                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `denied: denied` on login                       | Wrong token type / scope / account                                |
| `mkdir /home/deploy/.docker: permission denied` | `/home/deploy` owned by root → `chown deploy:deploy /home/deploy` |
| `docker pull … not found`                       | Image/tag not built yet — wait for the CI **image** job           |

## 7. GitHub Actions secrets (both repos)

Settings → Environments → **`production`** (the name must be exactly `production` —
secrets in an environment called `bytari-client` were invisible to the workflow and
produced `no argument after keyword "hostname"`).

| Secret            | Value                                                |
| ----------------- | ---------------------------------------------------- |
| `VPS_HOST`        | VPS public IP (`curl -4 ifconfig.me` on the VPS)     |
| `VPS_USER`        | `deploy`                                             |
| `VPS_SSH_KEY`     | Private CI key (full file, BEGIN/END lines included) |
| `VPS_KNOWN_HOSTS` | Output of `ssh-keyscan -t ed25519 VPS_IP`            |

Creating the CI key (on your computer):

```sh
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/bytari_ci -N ""
ssh-copy-id -i ~/.ssh/bytari_ci.pub deploy@VPS_IP     # or append .pub to /home/deploy/.ssh/authorized_keys as root
ssh -i ~/.ssh/bytari_ci deploy@VPS_IP "echo ok"
cat ~/.ssh/bytari_ci                                  # → VPS_SSH_KEY
```

In logs, GitHub masks secret values — `/opt/bytari/***/` is `/opt/bytari/deploy/`.

## 8. Releasing (build images)

```sh
# each repo
git tag vX.Y.Z && git push origin vX.Y.Z
```

Workflow: `ci` (typecheck, lint, prettier, tests — server ≈ 12 min) → `image` (push to GHCR) → `deploy` (rsync + `deploy.sh` over SSH).
Always use a **new** tag for a new commit; never reuse one.

CI problems fixed on the way:

| Symptom                                                         | Fix                                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Prettier fails on tag runs (checked the whole repo)             | Changed-files check skips when there is no base commit                                        |
| Mobile `TS2493 Tuple type '[string]'` in `AuthRedirector.tsx`   | `.expo/types` absent in CI → `const segments: string[] = useSegments()`                       |
| `containerFor(app): this app was not created by buildTestApp()` | Realtime test harness registers its app + uses `NoopEmailProvider`                            |
| `expected 86 to be 83` (rbac test)                              | Permission count updated (new chat-room / content-report permissions)                         |
| `expected 401 to be 404` for unknown routes                     | Report router was mounted at `/` with router-level `authenticate` → now mounted at `/reports` |

## 9. First deploy (as deploy, in `/opt/bytari`)

The first release is done by hand (each CI deploy only updates its own image;
the first one needs both).

```sh
docker pull ghcr.io/abdullahzayed812/bytari-server-v2:vX.Y.Z
docker pull ghcr.io/abdullahzayed812/bytari-client-v2:vA.B.C
deploy/scripts/init-letsencrypt.sh dummy                         # 1-day self-signed placeholder
SMOKE_INSECURE=1 deploy/scripts/deploy.sh --api-tag vX.Y.Z --web-tag vA.B.C
```

`deploy.sh` steps: validate env → pull → start db + backup → migrations + seeds →
start services (health-checked) → smoke tests → record release. A failure in pull
changes nothing; a failure after start rolls back to the previous images.

After changing nginx config or the domain: `init-letsencrypt.sh dummy`, then
`docker compose -f docker-compose.production.yml restart nginx` (deploy.sh does not reload nginx).

**Changing the domain later** (we moved `bytari.com` → `baytari.com`): replace it in both repos,
push new tags in both (the web image bakes the API URL in), edit `PUBLIC_WEB_ORIGIN`,
`CORS_ORIGINS`, `LETSENCRYPT_EMAIL` in the VPS `.env`, wait for CI to rsync the new
`deploy/`, then `dummy` → `restart nginx` → `deploy.sh` → `issue` (§10).

## 10. Real TLS certificate

```sh
dig +short baytari.com www.baytari.com api.baytari.com @1.1.1.1   # all = VPS IP
deploy/scripts/init-letsencrypt.sh issue --staging                 # dry run
deploy/scripts/init-letsencrypt.sh issue
curl -fsS https://api.baytari.com/health/ready
```

Failure `Invalid response … 403` from an IP that isn't the VPS = DNS still points
elsewhere (parking). The script restores the placeholder automatically; it is valid
for 1 day — re-run `dummy` if it expires. Renewal is automatic afterwards.

## 11. Seeds and the first admin

Every deploy runs `migrate.js seed`, which executes only these (all idempotent):

| Seed                     | Does                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `0000_placeholder`       | Nothing                                                                                                                           |
| `0010_rbac`              | Upserts system roles + permissions (never deletes)                                                                                |
| `0020_bootstrap_admin`   | Creates the admin from `BOOTSTRAP_ADMIN_*`; if that email exists, **resets its password** and re-activates it. Skipped when unset |
| `0030_organization_rbac` | Upserts organization roles + permissions (never deletes)                                                                          |

No demo data in production (`ENABLE_DEV_SEEDS=false`). There is no built-in admin account.

Create the admin (as deploy, in `/opt/bytari`):

```sh
openssl rand -base64 18                     # password (≥ 12 chars) → password manager
nano .env                                   # add BOOTSTRAP_ADMIN_EMAIL=… and BOOTSTRAP_ADMIN_PASSWORD=…
docker compose --env-file .env --env-file deploy/state/current.env -f docker-compose.production.yml \
  run --rm --no-deps api node dist/database/migrate.js seed
docker compose -f docker-compose.production.yml exec db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT u.email, u.status, r.key FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id;"'
```

The admin is `ACTIVE` (no email verification). After the first login **delete the
`BOOTSTRAP_ADMIN_*` lines** — otherwise every deploy (CI included) resets the admin
password back to the `.env` value. Create further admins from the admin panel.

## 12. After the first deploy

- [ ] Create the admin (§11), log in, then delete `BOOTSTRAP_ADMIN_*` from `.env`.
- [ ] Nightly backup (`crontab -e` as deploy):
      `15 3 * * * cd /opt/bytari && deploy/scripts/backup.sh nightly >> backups/backup.log 2>&1`
- [ ] Copy backups off the VPS (not automated yet).
- [ ] R2 bucket CORS: allow `https://baytari.com` (GET, PUT, HEAD; header `content-type`).
- [ ] Rotate the R2 secret key (it was exposed during setup) and any leaked GitHub token.
- [ ] Re-run failed CI deploy jobs → from now on a tag push deploys automatically.
- [ ] EAS production build: `GOOGLE_SERVICES_JSON` env var, API `https://api.baytari.com`, realtime `wss://api.baytari.com`.

## 13. Everyday commands (as deploy, in `/opt/bytari`)

`.env` contains `API_TAG=latest`, but CI never pushes a `latest` image — `deploy.sh`
passes the real tags and records them in `deploy/state/current.env`. A manual
`docker compose run` / `up` therefore fails with `…:latest: not found` unless that
file is passed too. Add an alias once:

```sh
echo "alias dc='docker compose --env-file /opt/bytari/.env --env-file /opt/bytari/deploy/state/current.env -f /opt/bytari/docker-compose.production.yml'" >> ~/.bashrc
source ~/.bashrc
```

Never run a plain `docker compose … up` without it (it would try to swap the API to `:latest`).
`ps`, `logs`, `exec`, `restart` on running containers are fine either way.

```sh
dc ps
dc logs -f --tail 200 api
dc run --rm --no-deps api node dist/database/migrate.js seed   # re-run seeds
cat deploy/state/current.env                           # deployed tags
deploy/scripts/deploy.sh --api-tag vX --web-tag vY     # manual deploy
deploy/scripts/rollback.sh                             # previous release
deploy/scripts/backup.sh manual                        # on-demand DB dump
```
