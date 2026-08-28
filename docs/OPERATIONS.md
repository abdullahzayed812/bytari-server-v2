# Operations & Release Runbook

Operational reference for running the Bytari backend in production. Companion to
`ARCHITECTURE.md` (design) and `README.md` (developer setup).

Every item below is tagged:

- **[Implemented]** — provided by the codebase / image as-is.
- **[Operational config]** — you must provision or configure this before going live.
- **[Future]** — recognised gap, not yet built. Do not assume it exists.

---

## 1. Runtime shape

| Concern               | Status            | Notes                                                                                                                                                                                                                                                |
| --------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process model         | **[Implemented]** | Single Node 20 process, HTTP + WebSocket on one port (`PORT`, default 3000).                                                                                                                                                                         |
| Container             | **[Implemented]** | Multi-stage `Dockerfile`, `node:20-alpine`, runs as `node` (non-root), `tini` as PID 1.                                                                                                                                                              |
| Container healthcheck | **[Implemented]** | `HEALTHCHECK` → `GET /health` (liveness). Compose `api` service mirrors it.                                                                                                                                                                          |
| Readiness             | **[Implemented]** | `GET /health/ready` returns 503 until the DB answers `select 1`. Wire it to your load-balancer / k8s `readinessProbe`.                                                                                                                               |
| Graceful shutdown     | **[Implemented]** | `SIGTERM`/`SIGINT` → stop accepting, close WS sockets (code 1001), drain infra, `db.destroy()`, exit. 10s hard-kill safety net (`server.ts`).                                                                                                        |
| Migrations on boot    | **[Implemented]** | Container `CMD` runs `migrate latest` + idempotent catalogue `seed` before `server.js`.                                                                                                                                                              |
| Horizontal scaling    | **[Future]**      | The WebSocket gateway is single-node (in-memory room index). Multiple API replicas work for REST, but realtime fan-out only reaches clients on the same node. A Redis-backed gateway is the documented swap point (`ARCHITECTURE.md` §16.4 / §23.4). |
| Background job runner | **[Future]**      | No external queue. Async work is in-process, post-commit `EventBus` handlers (notifications, realtime, push). See §6.                                                                                                                                |

---

## 2. Required operational configuration

All configuration is environment variables validated by `src/config/index.ts` —
the process **fails fast** on a bad/incomplete set. Nothing else reads
`process.env`.

### Mandatory in production (`NODE_ENV=production`)

| Var                                                                               | Why                                                                                                                                          |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`                                                               | ≥32 chars. Enforced by config validation. Rotating it invalidates all live access tokens (refresh tokens survive — they are opaque DB rows). |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` (or `DATABASE_URL`) | Postgres 16 connection.                                                                                                                      |
| `CORS_ORIGINS`                                                                    | Comma-separated allow-list. **Do not ship `*` with `credentials: true`** — set explicit origins.                                             |

### Strongly recommended

| Var                                      | Default                 | Recommendation                                                                                                                                                   |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_SSL`                                 | `false`                 | `true` for any network-separated database.                                                                                                                       |
| `DB_SSL_REJECT_UNAUTHORIZED`             | `false`                 | `true` when the DB presents a certificate from a CA your container trusts. Left `false` for managed providers with a private CA — document which applies to you. |
| `DB_STATEMENT_TIMEOUT_MS`                | `30000`                 | Per-connection `statement_timeout`. Keep non-zero so one runaway query cannot pin a pool slot.                                                                   |
| `DB_POOL_MAX`                            | `10`                    | Size to `(replicas × DB_POOL_MAX) < Postgres max_connections` with headroom for migrations and admin.                                                            |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | `300` / `20` per window | Tune to real traffic. The auth limiter is per-IP on the login / register / refresh routes under `/auth`.                                                         |
| `REALTIME_MAX_CONNECTIONS`               | `10000`                 | Hard cap per node; excess upgrades get HTTP 503. Set to your node's socket budget.                                                                               |
| `LOG_LEVEL`                              | `info`                  | `info` in prod. Logs are structured JSON (pino) on stdout — ship them off-host.                                                                                  |

### Optional integrations (all-or-nothing, blank ⇒ safe no-op)

| Group           | Vars                                                                                                          | Blank behaviour                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Firebase FCM    | `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`, or `FIREBASE_SERVICE_ACCOUNT_JSON`  | `NoopPushProvider` — in-app notifications still work, no device push.                                  |
| Cloudflare R2   | `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET` (+ optional `R2_PUBLIC_BASE_URL`) | In-memory object store — **volatile, never for production**. Content file uploads are lost on restart. |
| Bootstrap admin | `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` (≥12)                                                    | No admin auto-created. Provision the first admin another way (see §7).                                 |

Partially setting a group is a **hard config error** by design.

---

## 3. Secrets management

- **[Operational config]** Secrets are injected as env vars by the platform
  (k8s Secret, ECS task secret, Fly secret, …). `.env` is a developer
  convenience only and is git-ignored + docker-ignored.
- **[Implemented]** `.env.example` is the complete, committed template. No real
  secret is ever committed; `Dockerfile`/compose reference vars, never values
  (`docker-compose.yml` uses `${JWT_ACCESS_SECRET:?...}` so compose refuses to
  start without it).
- **[Implemented]** Secrets are never logged: pino config redacts nothing
  sensitive because credentials never enter log payloads — JWTs, refresh
  tokens, passwords, Firebase keys and R2 keys are kept out of log lines,
  audit metadata, realtime frames and API responses by construction.
- **[Operational config] Secret recovery.** Treat the secret store as the
  source of truth and back it up with the same rigour as the database:
  - `JWT_ACCESS_SECRET` — losing it only forces every user to obtain a fresh
    access token via `/auth/refresh` (refresh tokens are DB rows, unaffected).
    Rotate by deploying a new value; there is no key-ID/multi-key rotation
    window yet (**[Future]**), so rotation is a hard cutover.
  - DB credentials — recover from the managed-database console / IaC.
  - `FIREBASE_*`, `R2_*` — regenerate from the Firebase / Cloudflare console;
    old device tokens keep working, old R2 objects remain addressable.

---

## 4. Database: backup & recovery

**[Operational config] — the application does not perform backups.** You must
configure them at the infrastructure layer.

### Backups

- Use the managed provider's automated snapshots (point-in-time recovery) **or**
  a scheduled `pg_dump`:
  ```sh
  pg_dump --format=custom --no-owner --no-privileges \
    "$DATABASE_URL" > bytari-$(date -u +%Y%m%dT%H%M%SZ).dump
  ```
- Recommended: daily full + PITR/WAL archiving, ≥7-day retention, encrypted at
  rest, stored off the database host, restore-tested at least quarterly.
- The schema is small and fully migration-defined (19 migrations); the data is
  the only irreplaceable asset.

### Restore

```sh
# 1. Provision an empty database, point DATABASE_URL / DB_* at it.
# 2. Restore the dump:
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "$DATABASE_URL" bytari-<timestamp>.dump
# 3. Bring the schema to head (no-op if the dump was current):
node dist/database/migrate.js latest
# 4. Re-apply idempotent catalogues (safe any time):
node dist/database/migrate.js seed
# 5. Start the app; verify GET /health/ready and GET /api/v1/admin/audit-logs.
```

- **[Implemented]** Migrations and catalogue seeds are idempotent and additive —
  re-running them against a restored DB never destroys runtime-added rows
  (roles/permissions an admin created, etc.).
- Refresh sessions restored from an old dump simply expire / rotate normally;
  no manual cleanup needed.

### Migration rollback strategy

- **[Implemented]** Every migration ships a `down()` and is reversible:
  `node dist/database/migrate.js rollback` reverts the last batch.
- **[Operational config] Preferred production practice: roll _forward_.** A
  `down()` that drops a column/table is destructive. For a bad deploy:
  1. Redeploy the previous image (code) immediately.
  2. Only run `rollback` if the new migration is known to be safe to reverse
     (additive: new nullable column, new table, new index) **and** you have a
     fresh backup.
  3. For a destructive change, restore from backup rather than `down()`.
- Take a backup immediately before any deploy that includes a migration.
- Migrations run automatically on container start; a failed migration aborts
  the boot (`CMD` chain stops) and the old container keeps serving — deploy is
  effectively atomic per replica.

---

## 5. Object storage (Cloudflare R2) recovery

- **[Operational config]** R2 holds only **content module** binaries (article /
  book / magazine files). Everything else in Postgres references them by key.
- Enable **bucket versioning** and/or a lifecycle policy that retains
  non-current versions; R2 has no built-in point-in-time restore.
- Losing the bucket does **not** corrupt the database: content rows remain, file
  download URLs 404 until the objects are restored. Re-upload via the
  authenticated `POST /api/v1/admin/content/:id/files/upload-url` +
  register flow.
- **[Future] Orphan sweep.** A presigned upload URL that is issued but never
  registered leaves an unreferenced object. Replaced/deleted files are removed
  best-effort after commit; a storage failure there is logged
  (`"needs a sweep"`) and not retried. A periodic reconciliation job
  (list bucket ↔ `content_files.storage_key`) is not yet implemented.

---

## 6. Background processing & event reliability

- **[Implemented]** Domain flow is **DB transaction → commit → `EventBus`
  publish → async handler** (`InMemoryEventBus` publishes on the next
  microtask, so handlers never observe an uncommitted transaction).
- **[Implemented]** Handler isolation: notification fan-out processes recipients
  independently; a push-delivery failure is caught and logged and never rolls
  back or deletes the in-app notification. Invalid FCM tokens are pruned, not
  fatal.
- **[Implemented]** Idempotency: notification creation keys on
  `(recipient_user_id, source_event_key)` with a partial unique index +
  `INSERT … ON CONFLICT DO NOTHING`, so a redelivered event is a no-op.
- **[Future] At-least-once delivery / retries / dead-letter.** The bus is
  in-process and exactly-once _within a running process_; an event published
  while a handler is down is lost. Core data is never at risk (it is committed
  first), but a downstream side effect (a push, a realtime frame) can be
  missed. Moving to a durable queue is the documented upgrade path and the
  idempotency keys are already in place for it.
- **[Operational config]** Because side effects are best-effort, treat the
  Postgres row as truth and the notification/push/realtime as advisory in any
  client design.

---

## 7. First-run / bootstrap

1. Deploy with `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` set once;
   the `seed` step creates (or re-activates + re-hashes) that ADMIN user.
2. Log in, then **unset those vars** on the next deploy — the seed is a no-op
   without them, but leaving a known password configured is a standing risk.
3. Create real admins via `POST /api/v1/admin/users/:id/roles` and manage
   supervisors via `/api/v1/admin/supervisors`.

---

## 8. Observability

- **[Implemented]** Structured JSON logs on stdout (pino). Every request gets a
  correlation id: inbound `x-request-id` is honoured, else a UUID is generated,
  echoed on the response, and attached to every log line and error envelope
  (`error.requestId`).
- **[Implemented]** Log levels: 5xx / non-operational errors → `error` with the
  cause; 4xx → `warn`; success → `info`. Auth failures log the reason, never the
  token. Background handler failures log with context and never crash the
  process.
- **[Implemented]** `AuditService` writes an immutable `audit_logs` row (actor,
  action, entity, ip / user-agent / request-id, metadata) inside the same
  transaction as the audited change. Browsable at
  `GET /api/v1/admin/audit-logs`.
- **[Operational config]** Ship stdout to a log aggregator; alert on:
  sustained `level>=50` (error/fatal) rate, `GET /health/ready` failures,
  `"connection cap reached"`, `"needs a sweep"`, `REFRESH_TOKEN_REUSE_DETECTED`
  audit events, DB `statement_timeout` errors.
- **[Future]** No metrics endpoint (Prometheus) or distributed tracing
  (OpenTelemetry) yet. Correlation ids are logged but not propagated to a
  tracing backend.

---

## 9. Deploy checklist

- [ ] Backup taken (immediately before, if the release contains a migration).
- [ ] `JWT_ACCESS_SECRET`, DB creds, `CORS_ORIGINS` (explicit origins) set.
- [ ] `NODE_ENV=production`; config validation passes (container logs "started").
- [ ] `GET /health` 200 and `GET /health/ready` 200 on every replica.
- [ ] `GET /openapi.json` served; `/docs` loads.
- [ ] Smoke: register → login → refresh → `/auth/me`; one admin-only route
      returns 403 for a normal user; one cross-user resource returns 404.
- [ ] Rate-limit headers present on a burst to `/auth/login`.
- [ ] Log aggregation receiving structured lines with `reqId`.
- [ ] Rollback plan: previous image tag known; backup restore path rehearsed.

---

## 10. Known operational limitations (summary)

| Area            | Limitation                                | Mitigation / path                                                       |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Realtime        | Single-node fan-out                       | Sticky sessions + accept per-node delivery, or swap in a Redis gateway. |
| Events          | In-process, no durable retry / DLQ        | Postgres is truth; idempotency keys ready for a queue.                  |
| Storage         | No orphan-object sweep                    | Enable R2 versioning; manual reconciliation.                            |
| Secrets         | `JWT_ACCESS_SECRET` hard-cutover rotation | Schedule during low traffic; clients auto-refresh.                      |
| Metrics/tracing | None built in                             | Scrape logs; add OTel later.                                            |
| Backups         | Not application-managed                   | Provider snapshots + PITR (§4).                                         |
