# Bytari — Veterinary Platform Backend · Architecture Plan

> Living document. Phase 1 establishes the foundation; each later phase appends
> its module notes here.

## 1. Goals & constraints

- **One backend** serving one mobile app (Pet Owner mode, Veterinarian mode,
  Admin/Supervisor control panel) plus future web clients.
- **Multi-context users**: a user is not one fixed role. Authorization derives
  from `User + Role + Organization Membership + Organization Role + Supervisor
Scope + Permissions`, with Admin override.
- **Production-oriented**: typed end-to-end, modular, testable, no `any`,
  no business logic in controllers or DB triggers, no secrets in code.
- Built from scratch — no dependency on any legacy project.

## 2. Technology choices (Phase 1)

| Concern        | Choice                                 | Rationale                                                      |
| -------------- | -------------------------------------- | -------------------------------------------------------------- |
| Runtime        | Node.js 20 LTS, ESM                    | Modern, supported; `NodeNext` module resolution.               |
| Language       | TypeScript (strict)                    | `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.  |
| HTTP framework | Express 5                              | Stable, ubiquitous, minimal magic; async errors propagate.     |
| Database       | PostgreSQL 16                          | Required by spec.                                              |
| DB access      | Knex (query builder + pool)            | Migrations + seeds + transactions in one tool; explicit SQL.   |
| Migrations     | Knex migrations (TS→JS)                | `src/database/migrations/*.ts`, compiled for production.       |
| Validation     | Zod                                    | One schema library for config + request validation + OpenAPI.  |
| Config         | Zod-validated env loader               | Fail fast; single source of truth; no scattered `process.env`. |
| Logging        | pino + pino-http                       | Structured JSON in prod, pretty in dev, redaction built in.    |
| API docs       | OpenAPI 3.1 + swagger-ui               | Served at `/docs`, raw spec at `/openapi.json`.                |
| Testing        | Vitest + Supertest                     | Fast, native ESM/TS; unit + HTTP integration.                  |
| Lint/format    | ESLint (flat, type-checked) + Prettier |                                                                |
| Container      | Multi-stage Dockerfile + Compose       | Local Postgres + optional API container.                       |

## 3. Runtime shape

```
HTTP request
  → helmet · cors · body parsers
  → pino-http (assigns req.id, honours x-request-id)
  → rate limiter (skipped under NODE_ENV=test)
  → route: GET / , /docs , /openapi.json
  → API router  (mounted at /api/v1  AND unversioned for infra probes)
      → module routers (health, …)
        → controller (thin HTTP adapter)
          → application/domain service (business logic)
            → repository (Knex)  [from Phase 2]
  → notFoundHandler → errorHandler (single JSON envelope, logs by severity)
```

`createApp({ config, db, logger })` is a pure factory (no port binding).
`server.ts` wires real dependencies, binds the port, and handles graceful
shutdown (SIGTERM/SIGINT → drain HTTP → `knex.destroy()` → exit, with a 10s
hard-exit safety net).

## 4. Project structure

```
src/
  config/                 # env schema + typed loader (the only process.env reader)
  shared/
    errors/               # AppError hierarchy + stable error codes
    http/                 # response envelopes, asyncHandler, validate()
    middleware/           # request-logger, error-handler, not-found
    logger/               # pino factory
    events/               # EventBus interface + InMemoryEventBus
  database/
    knex.ts               # Knex instance factory + pingDatabase()
    knex-config.ts        # AppConfig → Knex.Config
    migrate.ts            # programmatic migrate/seed runner (dev + prod)
    migrations/           # *.ts, compiled to dist/database/migrations/*.js
    seeds/
    stubs/                # templates for `db:migrate:make` / `db:seed:make`
  infra/                  # transport/vendor adapters, isolated from modules
    realtime/             # WebSocket gateway, auth/authz seams, event bridge
    push/                 # push provider abstraction, FCM impl, device tokens
    storage/              # ObjectStorage abstraction, Cloudflare R2 impl
    index.ts              # createInfrastructure() composition root
  modules/
    health/               # health.service.ts · health.controller.ts · health.routes.ts
    <future modules>/     # auth, users, roles, permissions, organizations, ...
  routes/                 # root API router aggregating module routers
  openapi/                # base document + swagger-ui mount
  types/                  # ambient Express augmentation
  app.ts                  # application factory
  server.ts               # process entry point
test/
  unit/                   # pure logic, no I/O
  integration/            # Supertest HTTP stack + real-DB checks
```

### Module layering convention (Phase 2+)

Non-trivial modules use four layers; simple modules (like `health`) stay flat —
**do not over-engineer**.

```
modules/<name>/
  domain/          # entities, value objects, domain services, pure rules
  application/     # use-case services, DTOs, orchestration, transactions
  infrastructure/  # repositories (Knex), external adapters
  presentation/    # controllers, routers, request/response schemas
```

## 5. Cross-cutting contracts

### Response envelope

Success: `{ "data": <payload>, "meta"?: { ... } }`
Error: `{ "error": { "code": "<STABLE_CODE>", "message": "...", "details"?: [...], "requestId": "..." } }`

Clients branch on `error.code` (see `src/shared/errors/error-codes.ts`), never on
`message`. Validation failures return `422 VALIDATION_ERROR` with per-field
`details` (`{ path, message, rule }`).

### Error handling

Everything thrown in a handler flows to one `errorHandler`:

- `AppError` subclasses → their `statusCode` / `code` / `details`.
- `ZodError` → `422 VALIDATION_ERROR`.
- body-parser `SyntaxError` → `400 BAD_REQUEST`.
- anything else → `500 INTERNAL_ERROR`; message hidden in production; full cause
  logged at `error`. Operational errors log at `warn`.

### Validation

`validate({ body?, query?, params? })` parses with Zod and writes the coerced
result to `req.validated` (Express 5 `req.query` is read-only — never mutated).

### Authorization (design placeholder for Phase 2)

A single reusable authorization layer — **not** per-controller checks. Planned
shape: `authorize(permission, scopeResolver?)` middleware + a policy service that
evaluates, in order: Admin override → global role permissions → organization
membership + org-role permissions → supervisor scope. Permissions are
system-defined `resource.action` strings; clients never send role/permission
data that is trusted.

## 6. Database conventions (enforced from Phase 2)

- UUID PKs via `gen_random_uuid()` (`pgcrypto`, enabled in the baseline migration).
- `citext` for emails / handles / org identifiers.
- `created_at` / `updated_at timestamptz not null default now()`; `updated_at`
  maintained by the application layer, **not** triggers.
- Soft delete (`deleted_at timestamptz null`) where history matters.
- Explicit FKs, indexes on FKs and lookup columns, unique + check constraints.
- Multi-row writes run in transactions.
- Business rules live in application code; the DB enforces integrity only.

## 7. Infrastructure adapters (`src/infra/`)

Prepared in Phase 1 so later modules can use them without change. Every adapter
is isolated from business code: modules depend on a **narrow interface**, never
on `ws` / `firebase-admin` / `@aws-sdk`. The composition root
`createInfrastructure({ config, logger, eventBus })` builds them and returns a
`shutdown()` for graceful teardown. Missing vendor credentials degrade to a
safe local implementation (never a crash).

### 7.1 Domain event bus (`src/shared/events/`)

`EventBus` — `publish(name, payload)` (fire-and-forget, never throws) +
`subscribe(name | '*', handler)`. `InMemoryEventBus` delivers on the microtask
queue and isolates/logs handler failures. This is the decoupling layer:
modules publish domain events; infra bridges subscribe and fan out to WebSocket
/ push. A Redis/NATS implementation can replace it behind the same interface for
multi-node.

### 7.2 Real-time gateway (`src/infra/realtime/`)

- `RealtimePublisher` (module-facing): `emitToUser`, `emitToRoom`, `broadcast`,
  `isEnabled`, `connectionCount`. `RealtimeGateway` adds `attach(httpServer)` /
  `close()` for the bootstrap only.
- `WsRealtimeGateway` — `ws` on the shared HTTP port (`noServer` + `upgrade`).
  Heartbeat ping/pong, dead-socket termination, 1 MiB max frame.
- **Authenticated connections**: `ConnectionAuthenticator.authenticate(handshake)`
  → `RealtimePrincipal` or reject. Phase 1 ships `DenyAll` (default) and
  `Anonymous` (dev, `REALTIME_ALLOW_ANONYMOUS`, never in prod). **Phase 2 injects
  a JWT authenticator reusing the REST token verification.**
- **Same authorization / org-scoping as REST**: client `subscribe` requests pass
  through `RealtimeAuthorizer.canSubscribe(principal, room)`. Default
  `SelfRoomAuthorizer` allows only `user:{id}`; `CompositeRealtimeAuthorizer`
  lets each module register a rule for its room namespace (`org:*`,
  `conversation:*`, …) against the membership tables. Server-side emits are not
  gated.
- Rooms via `rooms.*` builders (`user:`, `org:`, `conversation:`, `consultation:`,
  `inquiry:`). Every socket auto-joins its own `user:` room.
- `RealtimeEventBridge` — subscribes the event bus; modules register
  `route(eventName, mapper)` to forward chosen domain events. No routes in Phase 1.
- Single-node; multi-node swaps a Redis-backed gateway behind `RealtimeGateway`.

### 7.3 Push notifications (`src/infra/push/`)

- `PushNotificationProvider` — `send(PushMessage)`, `isEnabled()`, `shutdown()`.
  `FirebasePushProvider` (FCM; `firebase-admin` imported dynamically, SDK app
  initialised lazily, credentials only from validated env), `NoopPushProvider`
  (logs; used when unconfigured). `createPushProvider()` chooses.
- `DeviceTokenRepository` — register / list-active / remove / disable, keyed by
  token, multiple devices per user. `InMemoryDeviceTokenRepository` now; the
  Postgres adapter + migration land in Phase 2 (needs the `users` table).
- `PushNotificationService` (module-facing) — `sendToUser` resolves a user's
  active tokens, delegates to the provider, and disables tokens the provider
  reports invalid. `PushEventBridge` maps domain events → pushes (no routes yet).

### 7.4 Object storage (`src/infra/storage/`)

- `ObjectStorage` — `put / get / head / exists / delete / getSignedUrl /
getPublicUrl`. `R2ObjectStorage` (Cloudflare R2 over the S3 API; credentials
  only from validated env), `InMemoryObjectStorage` (volatile; dev/test).
  `createObjectStorage()` chooses.
- Binaries never touch PostgreSQL — modules persist the returned `key` (+ size,
  content-type, etag). Key conventions and a traversal-safe `sanitizeKey` /
  dated `buildObjectKey` live in `storage/keys.ts`.

## 8. Identity & authorization (`src/modules/`, Phase 2)

### 8.1 Module map

| Module          | Responsibility                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `auth`          | password hashing, JWT issuing/verification, refresh sessions, register/login/refresh/logout, `authenticate` middleware |
| `users`         | the `users` record, account-status lifecycle, admin user APIs                                                          |
| `rbac`          | DB-backed roles/permissions + their relationships, role/permission admin APIs, the canonical constant catalogue        |
| `authorization` | permission **evaluation** (`AuthorizationService`) + `authorize()` / `requireApprovedVeterinarian()` guards            |
| `veterinarians` | the approval workflow (apply / pending / approve / reject)                                                             |
| `supervisors`   | system supervisor assignments (domain-scoped, not a role)                                                              |
| `audit`         | the single audit-log writer + admin read API                                                                           |

`src/container.ts` is the composition root: it wires repositories → services →
middleware once and hands routers fully-built collaborators. `createApp` builds
a container if one is not injected; `server.ts` injects one that shares the
event bus with the infrastructure layer (§7).

### 8.2 Authentication

- **Access token** — stateless HS256 JWT (`jose`), `sub` + `sid` claims,
  15 min default. Verified with issuer/audience checks and `algorithms:['HS256']`
  pinned (no `alg` confusion). Secret from `JWT_ACCESS_SECRET` — **required in
  production**, ephemeral-with-warning in dev.
- **Password hashing** — Argon2id (`@node-rs/argon2`, prebuilt binaries),
  OWASP-aligned parameters, isolated in `PasswordService`. Login verifies against
  a dummy hash for unknown emails to equalise timing.
- **Refresh sessions** — `refresh_sessions`, one row per device. The raw token is
  a 256-bit random string; only its SHA-256 hash is stored. Rotation on every
  refresh: old row `revoked_at` + `replaced_by_session_id` → new row. Replay of a
  **rotated** token (revoked _and_ has a successor) → revoke the whole family +
  `REFRESH_TOKEN_REUSE_DETECTED` audit (committed before the 401 is raised). A
  logout-revoked token (no successor) is just an invalid token, no family wipe.
- **Status enforcement** — `authenticate` reloads the user every request; a
  non-`ACTIVE` account is rejected (401) regardless of a still-valid token.
  Suspend/deactivate also revoke every refresh session.

### 8.3 Authorization model (the reusable core)

`AuthorizationService` is the ONLY place a "may X do Y" decision is made.
Resolution order, kept centralised:

```
authenticated principal
  → ADMIN role?              → allow (override; no permission rows needed)
  → else: union of permissions granted through the user's roles
          (user_roles ⋈ role_permissions ⋈ permissions)
  → veterinarian-only route? → additionally require veterinarianStatus = APPROVED
```

Controllers never branch on role names. Routes declare
`authorize('resource.action')`; `req.auth` is built server-side from the verified
token + DB row and is the only trusted source of role/permission/vet-status.

**Future-compatibility (Phase 3+):** `AuthPrincipal` is deliberately structural
and small. Organisation-scoped grants slot in as _additional steps_ in the
resolution order above (e.g. `org_memberships ⋈ org_role_permissions`), and a
`RealtimeAuthorizer`/policy object per room namespace already exists (§7.2).
Nothing in authentication or the permission tables needs to change — org grants
live in new tables keyed by `(user_id, organization_id, …)`.

### 8.4 Audit

`AuditService.record(entry, trx?)` is the single writer. Critical admin
operations pass the operation's transaction so the audit row is atomic with the
change (roll back together). `recordSafe` (best-effort, never throws) is for
non-critical out-of-transaction events. Metadata is sanitised (sensitive keys
redacted, size-capped); passwords/hashes/tokens never reach `audit_logs`.

### 8.5 Seeds

`0010_rbac` upserts the 4 roles + 22 permissions (18 identity + 4
`organization.admin.*` from Phase 3) + the role→permission matrix (idempotent,
additive — never deletes admin-added grants). `0020_bootstrap_admin` creates an
ADMIN **only** when `BOOTSTRAP_ADMIN_EMAIL` + `_PASSWORD` are in the environment;
nothing is hardcoded.

## 9. Organizations (`src/modules/organizations/`, Phase 3)

Four-layer module (`domain` / `infrastructure` / `application` / `presentation`).
A **unified `organizations` aggregate** for all types (CLINIC, FARM,
VETERINARY_OFFICE, VETERINARY_STORE) + thin per-subtype detail tables
(`clinic_details`, `farm_details` with `join_code`, `veterinary_office_details`,
`veterinary_store_details`).

### 9.1 Data model

| Table                                                                               | Purpose                                                                                                                                              |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`                                                                     | common aggregate: `type`, `name`, `owner_user_id` (FK RESTRICT), `status` (`PENDING`→`ACTIVE`/`REJECTED`/`SUSPENDED`/`DEACTIVATED`), decision fields |
| `<type>_details`                                                                    | per-subtype extension points; only `farm_details.join_code` carries a confirmed field                                                                |
| `organization_roles` / `organization_permissions` / `organization_role_permissions` | **separate** org RBAC catalogue (CHECK allows 2+ dotted segments, e.g. `organization.veterinarian.read`)                                             |
| `organization_memberships`                                                          | one row per (org, user) — `unique(organization_id, user_id)`; `status` `ACTIVE`/`SUSPENDED`/`REMOVED`/`LEFT`; re-join re-activates the row           |
| `organization_supervisor_permissions`                                               | per-membership selected permissions for SUPERVISOR members                                                                                           |

The owner is represented **both** as `organizations.owner_user_id` and as an
OWNER membership row, created atomically. Organizations are never physically
deleted.

### 9.2 Organization RBAC

Org roles: **OWNER** (no rows — full org access via the owner override),
**VETERINARIAN** (`organization.read`, `member.read`,
`organization.veterinarian.read`), **SUPERVISOR** (no rows — owner-selected
per assignment), **STAFF** (`organization.read`). Seeded by `0030_organization_rbac`.

### 9.3 Authorization — org scope (extension of §8.3)

`AuthorizationService` gains `getOrganizationMembershipContext` /
`canInOrganization` / `assertInOrganization`, wired with `MembershipRepository` +
`OrganizationRbacRepository`. Order:

```
1. ADMIN role                         → allow (global override)
2. no ACTIVE membership in that org    → deny
3. membership role OWNER               → allow (owner override; permission list is irrelevant)
4. otherwise → org-role permissions ∪ (SUPERVISOR only: per-membership selected permissions)
```

Presentation seam (`presentation/organization.middleware.ts`):
`withOrganization` resolves `:organizationId` (a **trusted route param**, never
the body) → `req.organization`; `authorizeOrg(perm)` then enforces
"org must be ACTIVE for non-admins" + `assertInOrganization`. This is why a
member of Clinic A hitting `/organizations/<ClinicB>/…` gets 403 — the check is
always against the membership for the URL's org id.

### 9.4 Type rules — `OrganizationPolicy`

The one place that branches on `organization.type`: `assertCanCreate`
(APPROVED-vet requirement for CLINIC/FARM, consulting `veterinarianStatus` not
the role), `assertCanBeSupervisor` / `assertCanHoldRole` (APPROVED-vet gates),
`hasJoinCode`, `generateJoinCode`, `validateTypeSpecificRules` (no-op extension
point).

### 9.5 Owner integrity

Enforced in the service layer: the OWNER membership cannot be removed (member
route _or_ admin route) or `LEFT` (`leave` → 409), so an organization can never
become ownerless. Owner transfer is intentionally not implemented (spec §20).

### 9.6 Events & audit

Domain events (post-commit, safe ids only): `organization.created` /
`.approved` / `.rejected` / `.suspended` / `.activated` / `.deactivated` /
`.member.added` / `.member.updated` / `.member.removed` / `.supervisor.assigned`
/ `.supervisor.updated` / `.supervisor.removed`. Audit actions mirror these
(`ORGANIZATION_*`), written **inside the operation's transaction** with the
authenticated caller as `actorUserId`.

## 10. Animals & ownership (`src/modules/animals/`, Phase 4)

Four-layer module (`domain` / `infrastructure` / `application` / `presentation`),
same conventions as §9.

### 10.1 Data model

Two tables, UUID PKs, `created_at` / `updated_at`:

- **`animals`** — identity + profile only: `name`, `species` (text + CHECK:
  DOG / CAT / BIRD / RABBIT / REPTILE / FISH / HORSE / OTHER), `breed` (nullable),
  `sex` (text + CHECK: MALE / FEMALE / UNKNOWN, default UNKNOWN), `date_of_birth`
  (nullable date), `notes` (nullable), `status` (text + CHECK: ACTIVE /
  DEACTIVATED), `created_by → users(id)` `ON DELETE RESTRICT`, `deactivated_at`.
  Indexes on `created_by` and `status`. LOST / FOR_ADOPTION / FOR_MATING are
  **not** core states (deferred — see §12).
- **`animal_ownerships`** — append-only ownership intervals: `animal_id →
animals(id)` `ON DELETE CASCADE`, `owner_user_id → users(id)` `ON DELETE
RESTRICT`, `started_at`, `ended_at` (nullable — `NULL` = current),
  `transferred_by → users(id)` `ON DELETE SET NULL`, `transfer_reason`. CHECK
  `ended_at IS NULL OR ended_at >= started_at`. Indexes on `owner_user_id` and
  `animal_id`, plus the invariant index:

  ```sql
  CREATE UNIQUE INDEX uq_animal_current_ownership
    ON animal_ownerships (animal_id) WHERE ended_at IS NULL;
  ```

**Ownership is never a column on `animals`.** The current owner is derived from
the single open `animal_ownerships` row. The partial unique index makes "two
current owners" impossible at the database level; the creator's opening row is
written in the same transaction as the animal, so "zero current owners" cannot
occur either.

### 10.2 Authorization — ownership scope (extension of §8.3)

`withAnimal` resolves `:animalId` (trusted route param) → `req.animal`
(`{ id, status, currentOwnerUserId }`); it never reads the body. Then:

- `authorizeAnimalWrite()` — allow if `isAdmin(principal)` **or**
  `currentOwnerUserId === principal.userId`; otherwise `404`.
- `authorizeAnimalRead(permission)` — same, plus a fallback to
  `authz.can(principal, permission)` for a reserved `animal.*` permission
  holder (granted to nobody by default; reserved for a future delegated
  Animal-Supervisor role).

**Cross-user access is `404`, not `403`** — a deliberate divergence from §9.3's
org convention, justified by the spec's strong animal-privacy language
(existence is not revealed to callers who cannot access the resource). The
collection routes (`POST` / `GET /animals`) are authentication-only and
self-scoped in the service — `GET /animals` returns only the caller's currently
owned animals, ADMIN included. Veterinarians get **no** implicit animal access.

New global permissions: `animal.read`, `animal.create`, `animal.update`,
`animal.delete`, `animal.ownership.read`, `animal.ownership.transfer` — added to
the catalogue for the ADMIN override + future delegation, granted to **no role**.

### 10.3 Lifecycle & transfer

- **Create** — any authenticated active user; no admin approval. One transaction:
  insert `animals` (`created_by` / owner both = `req.auth.userId`) + insert the
  opening `animal_ownerships` row + `ANIMAL_CREATED` audit. Client-supplied
  `ownerId` / `ownershipId` / `status` / `createdBy` / `id` are stripped by the
  Zod schema.
- **Update** (`PATCH`) — profile fields only; animal must be ACTIVE
  (`AnimalPolicy.assertMutable` → `409 ANIMAL_NOT_ACTIVE`). Never touches
  ownership or status.
- **Deactivate** (`DELETE`) — soft delete (`status = DEACTIVATED`,
  `deactivated_at = now()`); idempotent; ownership history untouched.
- **Transfer** (`POST /animals/:animalId/ownership/transfer`) — a domain
  operation, never a column update. Steps: load animal (`404`) →
  `assertMutable` (`409` if deactivated) → load current ownership → validate
  target via `AnimalPolicy.assertValidTransferTarget` (must exist → `404`; must
  be ACTIVE → `400 INVALID_TRANSFER_TARGET`; must not be the current owner →
  `409 INVALID_TRANSFER_TARGET`) → **transaction**: `endCurrent` (guarded — if
  it does not close exactly one row, `409` and roll back) + insert the new
  interval + `ANIMAL_OWNERSHIP_TRANSFERRED` audit → commit → publish. The
  previous owner is always read from the server; body ownership fields are
  ignored. Only the current owner (or ADMIN) reaches this route.

### 10.4 Events & audit

Domain events (post-commit, ids only): `animal.created`, `animal.updated`,
`animal.deactivated`, `animal.ownership.transferred`. Audit actions
`ANIMAL_CREATED` / `ANIMAL_UPDATED` / `ANIMAL_DEACTIVATED` /
`ANIMAL_OWNERSHIP_TRANSFERRED`, written **inside the operation's transaction**
with the authenticated caller as `actorUserId`; the transfer record's metadata
carries `animalId` / `previousOwnerId` / `newOwnerId` / `reason`. No passwords,
tokens or secrets in payloads or metadata.

## 11. Veterinary care (`src/modules/veterinary-care/`, Phase 5)

Four-layer module. Two entities — **medical records** and **vaccinations** —
plus the **CLINIC ↔ animal veterinary-access** relationship that gates them.

### 11.1 Three separate authorization concepts

The spec (docs 01 §1.9) forbids role-only authorization. Phase 5 keeps three
concerns strictly separate:

| Concept                      | Where it lives                                           | Grants                                          |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| **Animal ownership**         | `animal_ownerships` (Phase 4)                            | owner-facing **read-only** view of the history  |
| **Veterinary/clinic access** | `animal_clinic_access` (this phase)                      | a specific CLINIC may work on a specific animal |
| **Medical-record authz**     | organization RBAC (`medical_record.*` / `vaccination.*`) | which clinic members may do which operation     |

A medical write requires **all three chained**:

```
authenticated user
  → ACTIVE membership in the URL's organization
  → org permission for the operation (authorizeOrg)
  → ACTIVE animal_clinic_access grant for (animal, that clinic)   ← withVeterinaryAnimalAccess
  → (writes only) the target record was recorded by this clinic
```

Being an APPROVED veterinarian, or merely a clinic member, grants access to
**no** animal. ADMIN overrides every step.

### 11.2 Data model

| Table                  | Key columns / rules                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `animal_clinic_access` | `(animal_id, organization_id, status ACTIVE/REVOKED)`, `granted_by` / `revoked_by` (`SET NULL`). Partial unique index `uq_animal_clinic_access_active` → ≤1 ACTIVE grant per pair. `animal_id` / `organization_id` `ON DELETE CASCADE` (a pure relationship, no historical value).                                                  |
| `medical_records`      | `animal_id` + `organization_id` **`ON DELETE RESTRICT`** (history cannot be cascade-erased), `recorded_by_user_id` **`ON DELETE SET NULL`** (record outlives the vet), `visit_date` (default `CURRENT_DATE`), `reason` / `diagnosis` / `treatment` / `notes`. Each visit is a NEW row → historical diagnoses are never overwritten. |
| `vaccinations`         | same FK rules; `vaccine_name`, `administered_on`, `next_due_on` (nullable), `notes`. CHECK `next_due_on IS NULL OR next_due_on >= administered_on`.                                                                                                                                                                                 |

Postgres `date` columns are now parsed as raw `YYYY-MM-DD` strings
(`pg.types.setTypeParser(1082, …)` in `database/knex.ts`) — the default parser
builds a local-midnight `Date` that shifts a day when serialised in a non-UTC
timezone.

### 11.3 Scope decisions (from docs, not invented)

- **Only Medical Records + Vaccinations.** docs 04 §4.25 places exactly these two
  under "Veterinary Care". "Diagnoses / Treatments / Notes" (§4.4) are modelled
  as **fields of a medical record**, not separate aggregates. **No**
  veterinary-visit / examination / follow-up entities — they are not in the
  confirmed module map. **Attachments** are deferred (file storage is out of
  Phase 5 scope).
- **CLINIC only.** docs 01 §1.3.3 / docs 05 UC-016 speak of "the veterinarian
  assigned **in the clinic**". `VeterinaryCarePolicy.assertVeterinaryOrgType`
  rejects non-CLINIC orgs on grant; other types are a future extension point.
- **Full-history read.** docs 01 §1.3.3: "access the animal's **complete**
  medical record". A clinic with an ACTIVE grant reads every clinic's entries;
  it may `PATCH` / `DELETE` only its own (`organization_id` match → else 404).
- **Hard delete.** The spec lists "delete medical records" as an explicit
  veterinarian capability (docs 01 §1.3.3, UC-016). The audit log preserves the
  fact of deletion; non-destructive FKs prevent accidental cascade loss.
- **Clinic-association workflow is minimal** (task §5): a clinic member with
  `animal.veterinary.access.manage` (OWNER / assigned SUPERVISOR by default,
  **not** plain VETERINARIAN) grants access; no owner-approval step exists in the
  spec, so none was invented — it is a documented extension point.

### 11.4 Presentation

- **Clinic-facing** router mounted at `/organizations` (alongside the Phase 3
  router): `/:organizationId/animal-access…` and
  `/:organizationId/animals/:animalId/{medical-records,vaccinations}…`. Reuses
  `withOrganization` + `authorizeOrg`, then `withVeterinaryAnimalAccess`.
- **Owner-facing** read-only router mounted at `/animals`: reuses the Phase 4
  `withAnimal` + `authorizeAnimalRead` guards → current owner or ADMIN. Separate
  DTO mappers (`toOwner*DTO`) are the seam for future field-level redaction.

### 11.5 Events & audit

Domain events (post-commit, ids only): `veterinary_access.granted` / `.revoked`,
`medical_record.created` / `.updated` / `.deleted`, `vaccination.created` /
`.updated` / `.deleted`. Audit actions mirror these
(`ANIMAL_CLINIC_ACCESS_*`, `MEDICAL_RECORD_*`, `VACCINATION_*`), written **inside
the operation's transaction** with the authenticated caller as `actorUserId` and
`{ organizationId, animalId, <entityId> }` metadata. No secrets.

## 12. Farms & poultry (`src/modules/farms/`, Phase 6)

Four-layer module. A Farm **is** an Organization of type `FARM` — this module
reuses the Phase 3 aggregate, `organization_memberships`,
`farm_details.join_code` and the organization RBAC verbatim. It adds only two
things: the Farm-ID join flow (deferred from Phase 3) and the poultry domain.

### 12.1 Farm-ID join flow (docs 05 UC-013)

`POST /organizations/join` (body `{ joinCode }`), guarded by `authenticate` +
`requireApprovedVeterinarian()` — the joiner is not yet a member, so no
`authorizeOrg`. `FarmJoinService.joinByCode`:

```
resolve farm from farm_details.join_code   (404 INVALID_JOIN_CODE — generic)
  → FarmPolicy.assertFarmOrganization       (must be FARM)
  → FarmPolicy.assertFarmJoinable           (status ACTIVE → else 409)
  → transaction:
      findByUserAndOrg → FarmPolicy.resolveJoinAction(status)
        null   → create   VETERINARIAN / ACTIVE membership
        LEFT   → reactivate
        ACTIVE → noop (return existing, HTTP 200, no event)
        SUSPENDED / REMOVED → 403 (self-service rejoin refused)
      + FARM_MEMBER_JOINED audit
  → commit → publish farm.member.joined
```

No invitation, no acceptance, no admin approval (spec §3). Idempotent.
`organizationId` is never read from the body. Regeneration
(`POST /organizations/:organizationId/join-code/regenerate`, `organization.update`)
rotates the code inside a transaction with a `FARM_JOIN_CODE_REGENERATED` audit;
the old code stops resolving immediately. Multi-farm membership is automatic —
memberships are per `(organization_id, user_id)`, so a vet joins many farms and
leaving one (`LEFT`) touches nothing else (verified in tests).

### 12.2 Poultry data model

The spec (docs 04 §4.10) lists "Poultry Operations" as in scope but defines **no
concrete fields**. One entity is modelled — the universally-understood anchor:

| Table            | Columns / rules                                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poultry_flocks` | `name`, `bird_type` (text + CHECK: CHICKEN / DUCK / TURKEY / QUAIL / GOOSE / OTHER), `bird_count` (int, CHECK ≥ 0), `arrival_date`, `status` (ACTIVE / CLOSED), `notes`, `created_by_user_id` (`ON DELETE SET NULL`), `closed_at`. |

**DB-level farm isolation (task §19):** `poultry_flocks` carries an immutable
`organization_type` column, CHECK-pinned to `'FARM'`, and a **composite FK**
`(organization_id, organization_type) → organizations(id, type)` (backed by a new
`UNIQUE (id, type)` on `organizations`). A flock therefore _cannot_ reference a
non-FARM organization even if application code is bypassed. `ON DELETE RESTRICT`
protects flock data from a cascade.

Production / mortality / feed / health / vaccination sub-entities are deliberate
**future extension points** — not modelled (no spec fields). Cattle / sheep are
out of scope.

### 12.3 Authorization & isolation

Poultry routes: `withOrganization` → `authorizeOrg('farm.poultry.<x>')` →
(item routes) `withPoultryFlock`, which resolves `:flockId` **scoped by
`organization_id`** (a Farm A flock id under Farm B's URL → `404`, not a leak).
`PoultryFlockService` also calls `FarmPolicy.assertFarmOrganization` on
create/list (`400 ORGANIZATION_TYPE_NOT_SUPPORTED` for a non-FARM org whose
member/owner passes `authorizeOrg`). New org permissions
`farm.poultry.{read,create,update,delete}`: VETERINARIAN → full CRUD, STAFF →
`farm.poultry.read`, OWNER via override, SUPERVISOR via owner selection. Join
code needs no permission; regeneration reuses `organization.update`.

### 12.4 Events & audit

Domain events (post-commit, ids only): `farm.member.joined`,
`farm.join_code.regenerated`, `poultry.flock.created` / `.updated` / `.deleted`.
Audit actions `FARM_MEMBER_JOINED`, `FARM_JOIN_CODE_REGENERATED`,
`POULTRY_FLOCK_CREATED` / `_UPDATED` / `_DELETED`, written **inside the
operation's transaction**, actor = authenticated caller, metadata
`{ organizationId, … , <entityId> }`. No secrets.

## 13. Animal lifecycle publications (`src/modules/animals/`, Phase 7)

Animal identity/profile + ownership + transfer + history are §10 (Phase 4); the
clinic↔animal relationship is §11 (Phase 5). Phase 7 adds only the **Lost /
Adoption / Mating** publication lifecycle, as new files inside the existing
`animals` module.

### 13.1 One table, one lifecycle

`animal_publications` — a `kind` discriminator (`LOST` / `ADOPTION` / `MATING`)
over a single `PENDING → APPROVED / REJECTED` flow (docs 05 UC-005/006/007). The
spec defines no type-specific fields, so a table per type would be pure
duplication (spec §14 asks for a _reusable_ lifecycle). Columns: `animal_id`
(`ON DELETE RESTRICT`), `kind`, `status`, `note` (the only free field),
`created_by_user_id` (`RESTRICT` — the publisher, = current owner at publish),
`reviewed_by_user_id` (`RESTRICT`), `reviewed_at`, `rejection_reason`.

DB invariants:

- `CHECK` — a reviewed row has `reviewed_by` + `reviewed_at`; a `PENDING` row has
  neither. A `rejection_reason` exists only on `REJECTED`.
- Partial unique index `uq_animal_publications_open (animal_id, kind) WHERE
status = 'PENDING'` — at most one open publication of a kind per animal
  (stops moderation-queue spam; `REJECTED` frees a re-submission).

### 13.2 Authorization

- **Create** — owner-only, no ADMIN bypass. The route resolves the animal via
  Phase 4's `withAnimal`, then a guard requires `currentOwnerUserId ===
req.auth.userId` (else `404`, matching Phase 4 resource hiding). `kind` is the
  only client field beyond `note`; `status` / `reviewedBy` / `ownerUserId` are
  stripped by Zod.
- **Moderation** — `authorize('animal.approve' | 'animal.reject')` on the
  `/admin/animal-publications/*` routes. `AuthorizationService.can()` now has a
  **system-supervisor fallback**: after ADMIN override and global role
  permissions, it grants any permission implied by an ACTIVE
  `system_supervisor_assignments` domain (`SUPERVISOR_DOMAIN_PERMISSIONS`,
  docs 03 §3.10 — `ANIMAL` ⇒ `animal.{read,update,approve,reject}`). This is the
  first consumer of the Phase-2 supervisor table. `AuthorizationService` gained a
  fifth constructor arg (`SupervisorRepository`), mirroring the Phase-3 org
  extension. A wrong-domain supervisor, or the owner, gets `403`.
- **Read** — `/animals/:animalId/publications` is owner / ADMIN / `animal.read`
  holder (the ANIMAL supervisor); others `404`. `/animal-publications` is any
  authenticated user but returns **APPROVED only**, through a PII-free projection
  (`toOwnerMedicalRecordDTO`-style seam: `toPublicPublicationDTO` omits the
  publisher id, all moderation metadata and `status`).

### 13.3 Route placement

Owner routes are `/animals/:animalId/publications*` (two-segment, never shadowed
by Phase 4's `/animals/:animalId`). The public browse is a **top-level
`/animal-publications`** — a literal `/animals/lost` segment _would_ be shadowed
by `/animals/:animalId` (which 422s on a non-UUID before falling through).
Moderation is `/admin/animal-publications` per the admin-route convention.

### 13.4 Events & audit

Per-kind, post-commit, ids-only: `animal.{lost,adoption,mating}.{created,approved,rejected}`.
Audit actions `LOST_ANIMAL_{CREATED,APPROVED,REJECTED}` / `ADOPTION_*` /
`MATING_*` (docs §25), written **inside the operation's transaction**, actor =
authenticated caller (owner for create, moderator for review), metadata
`{ animalId, publicationId, kind, reason? }`. No secrets.

## 14. Medical history timeline (`src/modules/veterinary-care/`, Phase 8)

The medical domain — `medical_records` (with `diagnosis` / `treatment` / `notes`
fields), `vaccinations`, the `animal_clinic_access` grant, and the
`authenticate → withOrganization → authorizeOrg(medical_record.* | vaccination.*)
→ withVeterinaryAnimalAccess` gate — is §11 (Phase 5) and is **unchanged**.
Phase 8 adds one thing: a **composed, read-only medical-history timeline**.

### 14.1 What was NOT built (spec-checked)

- **Follow-ups**: not in the confirmed spec. docs 04 §4.4 (Medical Records) lists
  Diagnoses / Treatments / Notes / Vaccinations / Attachments — no follow-ups;
  §4.25's module map is Medical Records + Vaccinations only; UC-016/017 define no
  follow-up. The single `متابعة` token in `docs/` (`01_SCOPE.md:251`) is a
  consultation-thread action. A follow-up entity would be invented, so it was
  not. Extension point: `medical_records → follow_ups[]` or an independent
  `animal_follow_ups` table when the product defines it.
- **Standalone Diagnoses / Treatments tables**: docs 04 §4.4 groups them _inside_
  Medical Records → they are `medical_records.diagnosis` / `.treatment` text
  fields (Phase 5). No separate aggregate.
- **Medical Attachments**: deferred with file storage (R2 out of scope).
- **Owner write access to medical records**: the spec confirms only that
  veterinarians manage records without owner approval; owner _read_ is Phase 5's
  `/animals/:animalId/medical-records`. Owner write is intentionally absent.

### 14.2 The timeline

`MedicalHistoryService` (no repo, no table) composes the two Phase-5
repositories: it reads up to `PER_TABLE_CEILING` (1000) rows of each table for
one animal, maps them to `MedicalTimelineEntryDTO`
(`{ type: 'MEDICAL_RECORD' | 'VACCINATION', occurredOn, organizationId,
recordedByUserId, createdAt, medicalRecord? | vaccination? }`), merges,
sorts newest-first (`occurredOn` then `createdAt`), and paginates the merged
array in memory. `total = medicalTotal + vaccinationTotal`. No data is copied;
the sub-object is the existing DTO. `?type=` narrows to one kind.

Two routes, each reusing an existing guard chain verbatim — the service does
**no** authorization itself:

- `GET /organizations/:organizationId/animals/:animalId/medical-history` —
  `authorizeOrg('medical_record.read')` + `withVeterinaryAnimalAccess` (grant
  required; ADMIN overrides; cross-clinic → 404).
- `GET /animals/:animalId/medical-history` — Phase 4 `withAnimal` +
  `authorizeAnimalRead('animal.read')` → current owner or ADMIN.

No migration, no new permission, no audit, no events (read-only). Known limit:
an animal with >1000 records or >1000 vaccinations would page incompletely via
this endpoint — the dedicated Phase-5 list endpoints have full pagination.

## 15. Veterinary store & products (`src/modules/veterinary-store/`, Phase 10)

A **Veterinary Store is an Organization of type `VETERINARY_STORE`** (§9, Phase
3). Its creation, approval, profile, membership and supervisor management are the
existing organization endpoints — Phase 10 adds **no** owner / membership /
approval system and reuses `organizations.owner_user_id`,
`organization_memberships`, `AuthorizationService`, `withOrganization` and
`authorizeOrg`. It builds only the product domain.

### 15.1 Data model

One table, `products` (migration `20260901010000_veterinary_store_products.ts`):

| Column                      | Type                 | Notes                                                                                          |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                        | `uuid` PK            | `gen_random_uuid()`                                                                            |
| `organization_id`           | `uuid` NOT NULL      | the owning store                                                                               |
| `organization_type`         | `text` NOT NULL      | denormalised, `DEFAULT 'VETERINARY_STORE'`, `CHECK = 'VETERINARY_STORE'`                       |
| `name`                      | `text` NOT NULL      |                                                                                                |
| `description`               | `text` NULL          |                                                                                                |
| `product_type`              | `text` NOT NULL      | `CHECK IN ('MEDICINE','EQUIPMENT','SUPPLY','OTHER')`                                           |
| `price`                     | `numeric(12,2)` NULL | `CHECK price IS NULL OR price >= 0`; carried as a **string** end-to-end, never parsed to float |
| `stock_quantity`            | `integer` NOT NULL   | `DEFAULT 0`, `CHECK >= 0`                                                                      |
| `status`                    | `text` NOT NULL      | `DEFAULT 'ACTIVE'`, `CHECK IN ('ACTIVE','INACTIVE')`                                           |
| `created_by_user_id`        | `uuid` NULL          | `REFERENCES users(id) ON DELETE SET NULL` (server-derived, never from the body)                |
| `created_at` / `updated_at` | `timestamptz`        | `DEFAULT now()`                                                                                |

The store pin is a **composite FK** `(organization_id, organization_type) →
organizations(id, type) ON DELETE RESTRICT` (same pattern as `poultry_flocks` in
§12.2), backed by `organizations`' `uq_organizations_id_type`. A product
therefore cannot exist without a `VETERINARY_STORE` organization even against a
raw SQL insert, and `ON DELETE RESTRICT` keeps product history while any product
row survives. Indexes: `idx_products_org`, `idx_products_org_status`.

TS types + Zod schemas + Postgres `CHECK` each encode the two enums and the
non-negative constraints independently (defence in depth). `down()` drops only
`products` — Phase 6 owns `uq_organizations_id_type`.

### 15.2 Authorization — store scope (extension of §9.3)

Five keys added to the **organization** RBAC catalogue
(`organization-rbac.constants.ts` — the format-regex CHECK means no migration is
needed to add keys; `0030_organization_rbac.ts` re-seeds data-driven):

`product.read`, `product.create`, `product.update`, `product.delete`,
`product.inventory.adjust`.

Stock mutation is a **separate permission** (`product.inventory.adjust`), never
folded into `product.update`, so catalogue editing and stock control can be
delegated independently. Role grants: **STAFF** gets `product.read` only
(mirrors Phase 6's `farm.poultry.read`); **OWNER** relies on the owner override;
**SUPERVISOR** gets nothing by default — a store owner assigns product
permissions per-supervisor via `organization_supervisor_permissions`. ADMIN
overrides globally.

Every route is:

```
authenticate → withOrganization (resolves :organizationId, trusted route param)
             → withVeterinaryStore  (400 ORGANIZATION_TYPE_NOT_SUPPORTED if type ≠ VETERINARY_STORE)
             → authorizeOrg(<product permission>)
             → [withProduct]        (resolves :productId scoped to the store; 404 otherwise)
             → controller
```

`withProduct` looks up `findByIdForOrganization(productId, org.id)` — a product
id belonging to another store returns `404`, so Store A cannot probe Store B's
ids (IDOR guard). The org is always taken from the URL; `organizationId`,
`organizationType`, `createdBy`, `ownerUserId`, `updatedBy`, `status` and
`stockQuantity` in a request body are never read.

### 15.3 Operations

`ProductService` (`db`, `ProductRepository`, `AuditService`, `EventBus`,
`logger`) — every write opens one transaction that does the row change **and**
the audit `record()`, then publishes ids-only events **after commit**:

| Operation    | Route                       | Audit action                 | Event                 |
| ------------ | --------------------------- | ---------------------------- | --------------------- |
| create       | `POST …/products`           | `PRODUCT_CREATED`            | `product.created`     |
| list         | `GET …/products`            | —                            | —                     |
| get one      | `GET …/products/:id`        | —                            | —                     |
| update       | `PATCH …/products/:id`      | `PRODUCT_UPDATED` (`fields`) | `product.updated`     |
| deactivate   | `DELETE …/products/:id`     | `PRODUCT_DEACTIVATED`        | `product.deactivated` |
| adjust stock | `POST …/products/:id/stock` | `PRODUCT_INVENTORY_ADJUSTED` | `inventory.adjusted`  |

- **Soft-deactivation only.** `DELETE` sets `status = INACTIVE` (idempotent — a
  second call returns the row unchanged). Rows are never physically deleted:
  docs 04 §4.9 lists Orders / Purchasing as confirmed future concerns that will
  reference product history.
- **Stock is never trusted from the client.** `POST …/stock` takes
  `{ delta (signed, non-zero int), reason? }`; `StorePolicy.applyStockDelta`
  computes `current + delta`, throws `409 INSUFFICIENT_STOCK` if it would go
  negative, and the audit metadata records `delta` / `previousQuantity` /
  `newQuantity` / `reason`. `stockQuantity` on create is opening stock only; the
  `PATCH` body cannot touch stock. There is **no** `inventory_movements` ledger —
  the audit log is the movement history (a future ledger table is the extension
  point).
- **Money** is `numeric(12,2)`; the DTO field is `string | null`; Zod validates
  the string against `/^\d{1,8}(\.\d{1,2})?$/` and it is never converted to a
  number. No payment processing.
- Products are **private to the store's members** (`authorizeOrg`) — there is no
  public or cross-store browse (the spec does not confirm one).

### 15.4 What was NOT built (spec-checked — see §21.3)

- **Category model** — the spec (docs 04 §4.9) names "Categories" but defines no
  fields or hierarchy. Kept as the free-form `product_type` enum; a real
  `product_categories` table + `category_id` FK is the documented extension. No
  second category system was invented.
- **Product images** — no binaries in Postgres, no R2 wiring. The seam is a
  future `product_images` table holding object-storage keys once §7.4 storage is
  in scope.
- **SKU / barcode**, **multi-currency**, **discount / tax models** — not in the
  spec.
- **Pet Owner Store products** — a separate future domain; it will get its own
  table, not a `type` column on `products`.
- **Orders, Purchasing, Cart, Checkout, Payments, Subscriptions** — out of scope
  for this phase.
- **Per-product Admin approval** — not in the spec (a Veterinary Store is
  approved as an organization once); not added.

## 16. Chat & real-time messaging (`src/modules/chat/`, Phase 12)

The spec confirms **two** chat contexts and nothing else (docs 01 §9, docs 04
§4.15, UC-018 / UC-019 — "no open Group Chat for all farm members"):

| Type                | Sides                                                          | Anchored to    |
| ------------------- | -------------------------------------------------------------- | -------------- |
| `PET_OWNER_CLINIC`  | a pet owner ↔ **the CLINIC** (not one vet — UC-018)            | a `CLINIC` org |
| `FARM_OWNER_MEMBER` | the farm owner ↔ **one** assigned FARM member (vet / employee) | a `FARM` org   |

There is no `DIRECT` user-to-user type and no `VETERINARY_OFFICE` /
`VETERINARY_STORE` chat (not in the spec).

### 16.1 Data model

Three tables (migration `20260902010000_chat.ts`):

- **`conversations`** — `type` (CHECK enum), `organization_id` (FK → organizations
  `ON DELETE CASCADE`), `pet_owner_user_id` **xor** `member_user_id` (a
  `chk_conversations_shape` CHECK enforces exactly the right one per type),
  `created_by_user_id`, `last_message_at` (conversation-list ordering).
  **One conversation per relationship** is a DB guarantee: partial unique
  indexes `uq_conversations_pet_owner_clinic (organization_id, pet_owner_user_id)`
  and `uq_conversations_farm_member (organization_id, member_user_id)`. Concurrent
  "start conversation" calls race into the unique index and the service catches
  `23505` → re-fetches → returns the winner (idempotent; HTTP 200 vs 201).
- **`conversation_participants`** — the _individual_ sides only: the pet owner
  (PET_OWNER_CLINIC), or the owner + member (FARM_OWNER_MEMBER). The **clinic
  side has no rows** — it is "the clinic", resolved live from
  `organization_memberships`. `last_read_message_id` (FK → messages
  `ON DELETE SET NULL`) drives unread counts. `unique (conversation_id, user_id)`.
- **`messages`** — `sender_user_id`, `body` (CHECK length 1–4000), `type` (CHECK
  `TEXT` | `SYSTEM`; clients may only send `TEXT`), `deleted_at` +
  `deleted_by_user_id` (soft delete). Index
  `(conversation_id, created_at, id)` — the one hot query.

### 16.2 Authorization — relationship-scoped, evaluated live

`ChatService.resolveSide(userId, conversation)` is the single decision point,
used by the HTTP `withConversation` middleware **and** the realtime subscription
authorizer, so a socket can never join a room the caller could not `GET`:

- `PET_OWNER_CLINIC` → `userId === pet_owner_user_id` (**PET_OWNER**), OR an
  ACTIVE `organization_memberships` row for `(userId, organization_id)`
  (**CLINIC**).
- `FARM_OWNER_MEMBER` → `userId === organizations.owner_user_id` (**FARM_OWNER**,
  live lookup — not a stored snapshot), OR `userId === member_user_id` **and**
  their membership is still ACTIVE and non-OWNER (**FARM_MEMBER**).

No relationship → `404` (ids never leak; §33/§34). A **suspended / removed /
left** member loses access immediately; the org owner is unaffected (§35/§36).
**ADMIN is not special-cased** — a non-participant admin gets `404` on
ordinary endpoints (§38); the `chat.*` global permissions exist only for a
future Communication-Supervisor / explicit admin tooling, and are granted to no
base role (mirrors Phase 4 `animal.*`).

Conversation creation enforces the relationship server-side: a clinic member
must name a non-member `targetUserId` (clinic-initiated), a pet owner opens only
their own; the farm owner must name an ACTIVE non-owner member, a farm member
opens only their own with the owner. The org must be `ACTIVE`.

### 16.3 Messages, read state, soft delete

- Send: `authenticate → withConversation (relationship) → assertAccess (again) →
org ACTIVE check → txn(insert message + touch `last_message_at`+ advance the
sender's own`last_read`) → publish \`chat.message.created\` post-commit`. The
sender is `req.auth`; `senderUserId` in the body is rejected by the strict
  schema. Normal text messages are **not** audited (§39).
- List: paginated, **newest first** (`created_at desc, id desc`); a deleted
  message stays in the list with `body: null` + `deletedAt` set so ordering and
  unread state are preserved.
- Delete: `DELETE /messages/:messageId` — sender only, idempotent, soft
  (`deleted_at`). Audited `MESSAGE_DELETED`; emits `chat.message.deleted`.
- Unread: `unreadCount` per conversation for participants with a row (pet owner /
  farm owner / farm member) via one grouped query against `last_read_message_id`;
  `POST /conversations/:id/read` advances it. The dynamic **clinic side has no
  per-member read state in this phase** → `unreadCount: null` (documented TBD).

### 16.4 Real-time delivery & the WebSocket protocol

The Phase-1 `WsRealtimeGateway` (`src/infra/realtime/`) is unchanged; Phase 12
supplies the two seams it was built for:

- **`JwtConnectionAuthenticator`** (`src/modules/chat/realtime/`) — reuses the
  REST `TokenService.verifyAccessToken` + user reload + ACTIVE check. Token from
  the `Authorization: Bearer` header or an `access_token` query param (browser
  clients). No second login mechanism.
- **`ChatRealtimeAuthorizer`** registered on `CompositeRealtimeAuthorizer` for
  the `conversation` room kind → `ChatService.canAccessConversationId`
  (same check as §16.2). `user:<id>` keeps the default self-room rule; every
  other room kind is denied.
- **Bridge routes** (`createChatRealtime(container).registerBridgeRoutes`):
  `chat.message.created` / `chat.message.deleted` → `emitToRoom(conversation:<id>)`;
  `chat.conversation.created` → `emitToUser` for each participant id. **ids-only
  payloads** — no message body over the wire.

Wiring lives in `server.ts` (container → `createChatRealtime` →
`createInfrastructure({ realtimeAuthenticator, realtimeAuthorizer })` →
`registerBridgeRoutes`). Business logic never touches a socket.

**Client protocol** (JSON text frames, `{ type, data }`):

| Direction | Frame                                                                                                          | Notes                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| connect   | `GET <path>?access_token=<jwt>` (or `Authorization` header)                                                    | 401 on the upgrade if the token is missing/invalid/for a non-ACTIVE account |
| server→c  | `{ type: "welcome", data: { connectionId, userId, rooms } }`                                                   | auto-joins `user:<userId>`                                                  |
| c→server  | `{ type: "subscribe", data: { room: "conversation:<id>" } }`                                                   | authorized per §16.2                                                        |
| server→c  | `{ type: "subscribed", data: { room } }` / `{ type: "error", data: { message: "subscription denied", room } }` |                                                                             |
| c→server  | `{ type: "unsubscribe", data: { room } }` → `{ type: "unsubscribed", data: { room } }`                         |                                                                             |
| c→server  | `{ type: "ping", data: {} }` → `{ type: "pong", data: {} }`                                                    | plus transport-level ping/pong heartbeat                                    |
| server→c  | `{ type: "chat.message.created", data: { conversationId, messageId, senderUserId } }`                          | to `conversation:<id>` subscribers                                          |
| server→c  | `{ type: "chat.message.deleted", data: { conversationId, messageId } }`                                        |                                                                             |
| server→c  | `{ type: "chat.conversation.created", data: { conversationId } }`                                              | to each participant's `user:<id>` room                                      |

Offline recipients simply miss the live frame — the message is persisted and
retrieved later via `GET .../messages`. **No Firebase / push** in this phase; the
same domain events are the seam a future notification layer consumes.

### 16.5 What was NOT built (spec-checked — see §21.4)

- **Media / file / image messages** — not confirmed. `messages.type` reserves
  `SYSTEM`; a future `message_attachments` table would hold R2 object keys (no
  binaries in PG).
- **Message editing** — not in the spec (only soft delete, a project convention).
- **Per-clinic-member read state / receipts**, typing indicators, reactions,
  message search, conversation archive/mute — none confirmed.
- **Clinic-internal chat** (owner ↔ staff/vets) and **office/store chat** — the
  spec's §4.15 lists only Pet Owner ↔ Clinic and Farm Owner ↔ member.
- **Firebase push / WebSocket-driven business logic** — out of scope; events are
  the seam.

## 17. Consultations & inquiries (`src/modules/consultations/`, Phase 13)

Two structurally-identical support-thread aggregates (docs 05 §5.18–5.19,
UC-020…UC-027). They **share one kernel** — a generic `SupportThreadService` +
`ThreadRepository`, instantiated twice from `ThreadKindConfig` — but keep FULLY
separate tables, permissions, supervisor domains, realtime rooms, events and
audit actions. Domain separation is enforced by configuration + the
authorization layer, not by copy-pasted code. (`src/modules/inquiries/` is not a
separate module for this reason; ARCHITECTURE records the decision here.)

|                   | Consultation                                        | Inquiry                                                  |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------- |
| creator           | any authenticated user (Pet Owner)                  | **APPROVED veterinarian** (`assertApprovedVeterinarian`) |
| animal ref        | optional `animal_id`, creator must currently own it | none                                                     |
| tables            | `consultations`, `consultation_messages`            | `inquiries`, `inquiry_messages`                          |
| supervisor domain | `CONSULTATION`                                      | `INQUIRY`                                                |
| room              | `consultation:<id>`                                 | `inquiry:<id>`                                           |

### 17.1 Data model

Migration `20260903010000_consultations_inquiries.ts`:

- **`consultations` / `inquiries`** — `created_by_user_id` (FK → users
  `ON DELETE CASCADE`), `status` (CHECK `OPEN | CLOSED`), `sender_blocked_at`
  (UC-023 / UC-027 — mutes the creator while the thread stays OPEN for
  responders), `ai_responded`, `last_message_at`, `closed_at` /
  `closed_by_user_id`. Consultations additionally have nullable `animal_id`
  (FK → animals `ON DELETE SET NULL`).
- **`consultation_messages` / `inquiry_messages`** — `sender_user_id`
  (nullable FK → users `ON DELETE SET NULL`), `source` (CHECK
  `USER | SUPERVISOR | ADMIN | AI | SYSTEM`), `body` (CHECK length 1–4000),
  `deleted_at`. A `chk_*_sender` CHECK pins the invariant **human message ⇒
  sender set; AI/SYSTEM ⇒ sender null**, so an AI message can never be
  attributed to a user (no AI impersonation at the DB level). Index
  `(thread_id, created_at, id)`.
- **`ai_settings`** — a tiny admin-owned flag table, keys `CONSULTATION_AI` /
  `INQUIRY_AI` (CHECK), `enabled` (default false), `updated_by_user_id` **as a
  plain uuid with no FK** so the test suite's `TRUNCATE users CASCADE` never
  wipes it. Both rows are seeded by the migration; the service reads default
  `false` when a row is absent, so a missing row is harmless.

### 17.2 Authorization

`SupportThreadService.resolveSide(principal, thread)` is the single decision
point (HTTP middleware + realtime authorizer):

- **CREATOR** = `thread.createdByUserId === principal.userId`. Always may read;
  may post only while `OPEN` and `sender_blocked_at IS NULL`; **cannot** close
  or block.
- **RESPONDER** = `authz.can(principal, '<kind>.read')` **AND**
  (`isAdmin` **or** `isApprovedVeterinarian`). `authz.can` resolves the ADMIN
  override or an ACTIVE `CONSULTATION` / `INQUIRY` system-supervisor domain via
  `SUPERVISOR_DOMAIN_PERMISSIONS` (populated for these two domains in Phase 13).
  So a `CONSULTATION` supervisor cannot touch an inquiry and vice-versa; and
  the check is **live** — deactivating the assignment, or revoking the
  supervisor's vet approval, removes responder access on the next request.
- No relationship → `404` (ids never leak). **ADMIN is not special-cased for
  ordinary user endpoints** beyond the permission override — a non-participant
  admin still reaches a thread only through `authz.can`, which is always true
  for ADMIN, so admins do have full access (brief §5) but through the single
  documented path.

Message `source` is derived, never from the body: CREATOR → `USER`; RESPONDER →
`ADMIN` if `isAdmin` else `SUPERVISOR`; the AI path → `AI` with a null sender.
`.strict()` Zod schemas reject `senderUserId` / `createdBy` / `senderType` /
responder-identity keys (422).

Permissions added to the **global** catalogue (`rbac.constants.ts`), granted to
**no base role** (like `animal.*` / `chat.*`): `consultation.create` (reserved),
`consultation.read`, `consultation.respond`, `consultation.close`,
`consultation.admin.read`; the five `inquiry.*` equivalents; and
`ai.settings.manage` (ADMIN-only — not in any supervisor domain).

### 17.3 Lifecycle & messages

`OPEN → CLOSED` (terminal for everyone; responder/admin only; idempotent).
`sender_blocked_at` is an orthogonal mute of the creator (responder/admin;
idempotent). `ThreadPolicy` encodes the writability rules; a blocked/closed
write returns `THREAD_NOT_WRITABLE` (403 blocked / 409 closed). Every write is
one transaction (message insert + `last_message_at` touch + audit for lifecycle
transitions only — **normal messages are not audited**); the domain event is
published **after commit**. Message lists are paginated **oldest-first**
(chronological reading of an AI + human thread).

### 17.4 AI response flow (seam only — no provider)

`AiResponderPort` (`generate({kind, threadId, messages}) → string | null`) is the
only coupling point. Phase 13 binds `NoopAiResponder` (always `null`). On thread
creation, **after the transaction commits**, `maybeAiRespond` runs: if
`ai_settings` for the kind is enabled it calls the port; a non-null reply is
persisted as an `AI` message (null sender) in its own transaction and
`<kind>.message.created` is published. A provider error is caught, logged and
swallowed — the consultation/inquiry stays intact. The DB transaction is never
held open across the port call. A Phase 14+ provider implements `AiResponderPort`
and is bound in `createContainer` (`ContainerDeps.aiResponder`); nothing else in
the domain changes.

### 17.5 Realtime

Layered on the Phase-12 seam with zero new transport code: `createSupportRealtime`
registers `consultation` / `inquiry` room kinds on the shared
`CompositeRealtimeAuthorizer` (each delegating to `SupportThreadService.canAccess`
— same check as REST) and adds bridge routes (`*.message.created` / `*.closed` /
`*.sender_blocked*` → thread room; `*.created` → the creator's `user:<id>` room).
The realtime authorizer rebuilds a full `AuthPrincipal` (user + roles +
vet-status) per subscription so the live vet/supervisor check applies to sockets
too. Payloads are ids-only.

### 17.6 What was NOT built (see §21.4)

- **A real AI provider** — Phase 14+ (`AiResponderPort` is the seam).
- **AI conversation memory / streaming / per-thread AI config** — the flag table
  is `key → enabled` only; it is extensible (add a key + CHECK).
- **Blocking a _specific_ participant** other than the creator, or per-message
  moderation/redaction — only the whole-creator mute exists.
- **Consultation categories / attachments / animal timeline linkage** — no spec.
- **Notifications delivery** (Firebase / in-app) — the events are the seam; no
  consumer in this phase.

## 18. Content management (`src/modules/content/`, Phase 14)

One unified `contents` aggregate — `ARTICLE | BOOK | MAGAZINE` (docs 04 §4.23) —
with a `DRAFT → PUBLISHED → ARCHIVED` lifecycle and project-standard soft-delete.
Files (book/magazine documents, cover images, article attachments) are stored in
**Object Storage** (the Phase-1 `ObjectStorage` abstraction / Cloudflare R2);
PostgreSQL keeps metadata only. Admin-managed `categories` are a lightweight M:N
label set — the specific taxonomy is not in the spec, so none is seeded.

### 18.1 Data model

Migration `20260904010000_content.ts`:

- **`contents`** — `type` / `status` (CHECK enums), `title` (CHECK 1–300),
  `description`, `body` (article text, **stored verbatim** — see §18.6),
  `author_name`, `published_at`, `created_by_user_id` / `updated_by_user_id`
  (FK → users `ON DELETE SET NULL`), `deleted_at`. A `GENERATED ALWAYS AS …
STORED` `tsvector` column (`to_tsvector('simple', title || ' ' ||
description)`) + GIN index backs search — no unbounded ILIKE. Partial index
  `(status, type, published_at DESC) WHERE deleted_at IS NULL` for the hot
  public query.
- **`content_files`** — `content_id` (FK `ON DELETE CASCADE`), `kind` (CHECK
  `MAIN | COVER | ATTACHMENT`), `storage_key`, `storage_provider`,
  `original_filename`, `mime_type`, `size_bytes` (bigint, CHECK ≥ 0),
  `checksum`, `deleted_at`. Partial unique indexes: one live `MAIN` and one live
  `COVER` per content; `storage_key` unique among live rows.
- **`categories`** — `slug` (CHECK `^[a-z][a-z0-9-]{0,63}$`, unique among live
  rows), `name`, `description`, `deleted_at`. **`content_categories`** — M:N
  join, PK `(content_id, category_id)`, both FKs `ON DELETE CASCADE`.

### 18.2 Authorization

Public reads (`GET /content`, `/content/:id`, `/content-categories`) are
**authenticated only** — no permission gate — and expose **only PUBLISHED,
non-deleted** items (a draft / archived / deleted id → `404`). Public file DTOs
omit `storageKey` / `storageProvider`; download is via a dedicated route that
returns a public CDN URL or a short-lived (300 s) signed GET URL.

Management (`/admin/content*`, `/admin/content-categories*`) goes through
`authorizeContent(permission)` = `authz.assert(principal, permission)` **AND**
(`isAdmin` **or** `isApprovedVeterinarian`). `authz.assert` resolves the ADMIN
override or the **CONTENT system-supervisor domain**
(`SUPERVISOR_DOMAIN_PERMISSIONS.CONTENT`). Both checks are **live** — revoking
the supervisor assignment or the vet approval removes access on the next
request.

Global permissions added (granted to **no base role**): `content.read`,
`content.create`, `content.update`, `content.delete`, `content.publish`,
`content.archive`, `content.upload`, `content.category.manage`. The CONTENT
domain grants **all of these except `content.delete`** — soft-delete / restore
stay ADMIN-only.

### 18.3 Lifecycle

`ContentPolicy` returns whether a transition actually changes state so
publish/archive are **idempotent** (a repeat call is a 200 no-op). `publish`:
`DRAFT | ARCHIVED → PUBLISHED`, stamping `published_at` only the first time.
`archive`: `DRAFT | PUBLISHED → ARCHIVED`. Archiving a DRAFT is allowed (removes
an unfinished item from the managers' active view without deletion). Soft-delete
/ restore toggle `deleted_at` and are idempotent. Every mutation is one
transaction (row change + category replace + audit); the domain event fires
**after commit**.

### 18.4 Storage & the presigned upload flow

Modules depend only on `ObjectStorage`; the R2 SDK stays in `src/infra/storage/`.
Upload is **presigned direct-to-storage** — the app server never proxies file
bytes:

1. `POST …/files/upload-url` — validates permission + `kind`/MIME/size against
   `ALLOWED_MIME` + `MAX_FILE_BYTES` (100 MiB), then returns a
   **server-generated** key (`buildObjectKey(prefix(type), filename)` — the
   client can never choose it) and a 600 s signed `PUT` URL. **No DB write.**
2. Client `PUT`s the bytes straight to storage.
3. `POST …/files` — verifies the key sits under this content's prefix
   (`STORAGE_KEY_MISMATCH` / 409 otherwise), `HEAD`s the object
   (`STORAGE_OBJECT_MISSING` / 400 if absent), and **re-validates the object's
   REAL size / content-type**. A `MAIN` / `COVER` upload supersedes the prior
   one; the old object is deleted **best-effort AFTER commit**.

The DB transaction is never held open across a storage call. Cleanup failures
(§18.5) are logged, never rolled back. An **abandoned presigned upload** (URL
issued, never registered) leaves an unreferenced object — swept by a future
retention job (§21.4).

### 18.5 Failure handling (§28 of the brief)

| Scenario                                                   | Behaviour                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| upload URL issued, client never registers                  | orphan object; no DB row; future sweep of unreferenced `content/*` keys           |
| register: object missing / wrong prefix / bad type-size    | 400 / 409, no DB row, no event                                                    |
| replace / delete file: DB commits, storage `delete` throws | **not** rolled back — logged (`needs a sweep`), 200 returned, event still emitted |
| register: storage fine, DB tx fails                        | tx rolls back; the just-uploaded object is an orphan (same sweep)                 |

### 18.6 Article body & XSS

The article `body` is stored **verbatim** as untrusted text with a 100 000-char
cap and returned as-is; the API **never renders or interprets it**. Consumers
MUST escape / sanitise on display. Server-side HTML sanitisation (e.g.
`sanitize-html` at the presentation boundary) is a documented future addition —
it is not needed while the representation is inert text.

### 18.7 Audit, events & realtime

Audit (in-transaction, ids only, **no storage keys / URLs / credentials /
article body**): `CONTENT_CREATED`, `_UPDATED`, `_PUBLISHED`, `_ARCHIVED`,
`_DELETED`, `_RESTORED`, `CONTENT_FILE_UPLOADED` / `_REPLACED` / `_DELETED`,
`CONTENT_CATEGORY_CREATED` / `_UPDATED` / `_DELETED`.

Events (ids + safe metadata only, post-commit): `content.created`,
`content.updated`, `content.published`, `content.archived`, `content.deleted`,
`content.restored`, `content.file.uploaded` / `.replaced` / `.deleted`,
`content.category.created` / `.updated` / `.deleted`.

Realtime: a single fixed room **`content:feed`** (`rooms.contentFeed()`).
`ContentFeedAuthorizer` (registered on the shared `CompositeRealtimeAuthorizer`
for the `content` kind) lets a socket subscribe only if it holds `content.read`
AND is ADMIN / approved-vet — the same gate as the HTTP admin routes. Bridge
routes forward every `content.*` event to that room. Normal users get no content
realtime.

### 18.8 What was NOT built (see §21.4)

- **Real R2 end-to-end verification** — tests use the in-memory `ObjectStorage`;
  a real bucket needs `R2_*` credentials (documented).
- **Direct multipart proxy upload** — the presigned flow is the only path.
- **Content versioning / revision history** — updates overwrite; the audit log
  is the history. The schema (immutable `id`, `updated_by`, timestamps) leaves
  room for a future `content_revisions` table without restructuring.
- **HTML/rich-text sanitisation**, per-file virus scanning, image
  trans/thumbnailing, an orphan-object sweep job, and any
  Notifications/Firebase consumer of the events.

## 19. Notifications & Firebase FCM (`src/modules/notifications/`, Phase 15)

The push **infrastructure** shipped in Phase 1 (`src/infra/push/`) — the
`PushNotificationProvider` abstraction, `FirebasePushProvider` (dynamic
`firebase-admin` import, lazy SDK init, invalid-token detection, 500-token
batching), `PushNotificationService`, `PushEventBridge`, and the Firebase config
with fail-fast validation. Phase 15 adds the PostgreSQL persistence and the
`notifications` module on top. **No domain module imports `firebase-admin`.**

### 19.1 Flow

```
domain op → DB tx → commit → EventBus
                               → NotificationEventHandler (ALL_EVENTS)
                                   → NotificationPolicy.resolve(event) → NotificationSpec[]
                                       → NotificationService.deliverSpecs
                                           → notifications row  (source of truth)
                                           → publish notification.created (→ realtime user:<id>)
                                           → PushNotificationService.sendToUser  (FCM, best-effort)
```

The handler subscribes in `createContainer` (so `buildTestApp` gets it without
infra). It ignores its own `notification.*` events (loop guard) and swallows all
errors. Events are already post-commit, so no notification work runs inside
another module's transaction.

### 19.2 Data model

Migration `20260905010000_notifications.ts`:

- **`notifications`** — `recipient_user_id` (FK users CASCADE), `type` (CHECK
  `^[A-Z][A-Z0-9_]*$`), `title` / `body` (CHECK length), `data` (jsonb —
  ids/navigation only), `actor_user_id`, `entity_type` / `entity_id`,
  `source_event_key`, `read_at`. Indexes: `(recipient_user_id, created_at)` for
  the list; partial `(recipient_user_id) WHERE read_at IS NULL` for the unread
  count; **partial unique `(recipient_user_id, source_event_key)`** — idempotency
  (§19.6).
- **`device_push_tokens`** — `user_id` (FK CASCADE), `token` (**globally
  unique** — one row per FCM token; re-registering upserts and moves ownership),
  `platform` (CHECK `ios|android|web`), `device_id?`, `app_version?`,
  `last_seen_at`, `revoked_at`. `DeviceTokenRepository` is the PG adapter of the
  Phase-1 `DeviceTokenRepository` port (+ user-scoped list / delete-by-id
  helpers).
- **`notification_preferences`** — `user_id` PK, `push_enabled` (default true).
  Row created lazily; missing ⇒ defaults. Only gates FCM push — **in-app
  notifications are always created**. Extensible to per-type / per-channel later
  without touching the handler.

### 19.3 Recipient policy (`NotificationPolicy`)

One place maps an event → targets, resolving recipients from **current** domain
relationships and always **excluding the sender / actor**:

| event                                                               | recipients                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `organization.approved` / `.rejected` / `.suspended` / `.activated` | the org owner                                                                                                      |
| `organization.member.added` / `.removed` (not self-`left`)          | the member                                                                                                         |
| `organization.supervisor.assigned` / `supervisor.assigned`          | the assigned user                                                                                                  |
| `chat.message.created`                                              | FARM: the other of {owner, member}; CLINIC: the pet owner ↔ the active clinic members (cap 200) — minus the sender |
| `consultation.created` / `inquiry.created`                          | active `CONSULTATION` / `INQUIRY` domain supervisors (minus the creator)                                           |
| `consultation.message.created` / `inquiry.*`                        | `source=USER` → the domain supervisors; `SUPERVISOR`/`ADMIN`/`AI` → the thread creator                             |
| `consultation.closed` / `inquiry.closed`                            | the thread creator                                                                                                 |
| `content.published`                                                 | **none** — no spec requires a broadcast (§21.4)                                                                    |

An unmapped event → no notification. Catalogue in
`notification.constants.ts` (`NOTIFICATION_TYPES`) — extensible.

### 19.4 Three independent channels

`notifications` row = source of truth. `NotificationService.deliverOne` inserts
it in a transaction, then **after commit**: publishes `notification.created`
(realtime), and — if the row was new and `push_enabled` — calls
`PushNotificationService.sendToUser` (which resolves the user's active tokens,
delegates to the provider, and **auto-revokes tokens the provider reports
invalid**). Each channel's failure is caught and logged; it never removes the
row or blocks the others. Per-recipient failures in a fan-out don't stop the
rest.

### 19.5 Endpoints & realtime

`/notifications*` is authentication + ownership only — every repository query is
`recipient_user_id` / `user_id`-scoped, so an id belonging to another user is a
`404` (no `403`, no leak). Device DTOs return only a `tokenSuffix`, never the
raw token. `POST /admin/notifications` needs `notification.admin.send`
(granted to no base role → ADMIN override); `target` is `USER` | `ROLE` | `ALL`,
in-app rows written synchronously in batches, FCM fan-out **detached** from the
response, refused above `MAX_BROADCAST_RECIPIENTS` (5000) — a durable queued job
is the future path (§21.4).

Realtime reuses the Phase-12 seam: `notification.created` / `notification.read`
→ `emitToUser(recipientUserId, …)` on the recipient's `user:<id>` room. No new
authorizer — that room is already self-only (`SelfRoomAuthorizer`). Payloads are
ids-only (`{ notificationId, type }`) — no title / body over the wire.

### 19.6 Idempotency

`source_event_key` (e.g. `consultation.message.created:<messageId>`) + the
partial unique index + `INSERT … ON CONFLICT DO NOTHING` mean a repeated domain
event never creates a duplicate. Admin broadcasts have no key (an admin may
deliberately send the same announcement twice). The current `InMemoryEventBus`
delivers exactly once, so this only matters for a future at-least-once bus —
documented, no EventBus change made.

### 19.7 What was NOT built (see §21.4)

- **Real FCM end-to-end** — tests use `FakePushProvider`; real delivery needs
  valid `FIREBASE_*` credentials (documented).
- **Durable retry / broadcast queue** — transient FCM failures are logged, not
  retried; large broadcasts are capped, not queued.
- **Per-type / per-channel preferences**, quiet hours, digest batching.
- **`content.published` fan-out**, category-subscription targeting — the
  `ALL` / `ROLE` admin path is the seam.
- Notification **retention / cleanup** — rows are kept; a cron is a future item.

## 20. Phase status

- [x] **Phase 1 — Foundation**: project setup, config, logging, error handling,
      validation, Knex + migrations + seed runner, Docker, OpenAPI, health
      endpoints, unit + integration tests. Plus infrastructure foundations
      (§7): domain event bus, WebSocket real-time gateway, push-notification
      abstraction (FCM), object-storage abstraction (Cloudflare R2).
- [x] **Phase 2 — Identity & Authorization** (§8): users, JWT auth + rotating
      refresh sessions, DB-backed roles/permissions, central authorization
      service + guards, veterinarian approval workflow, system supervisor
      assignments, account-status management, audit log.
- [x] **Phase 3 — Organizations & org-scoped authorization** (§9): unified
      organizations aggregate + subtype detail tables, approval lifecycle,
      membership model, separate organization RBAC, per-supervisor selected
      permissions, `AuthorizationService` org extension + `authorizeOrg`
      middleware, admin org control, org domain events + audit.
- [x] **Phase 4 — Animals & Ownership** (§10): Animal Core (identity + profile),
      append-only `animal_ownerships` history with a partial unique index for the
      one-current-owner invariant, creator-becomes-owner on create,
      ownership-scoped access (404 for non-owners) with ADMIN override, ownership
      transfer as a transactional domain operation, animal domain events + audit.
- [x] **Phase 5 — Veterinary Care & Medical Records** (§11): `animal_clinic_access`
      grant (clinic ↔ animal, independent of ownership), medical records +
      vaccinations as the animal's shared history, three-layer authz
      (membership → org permission → access grant → own-record for writes),
      owner-facing read-only view, veterinary domain events + audit. Ownership
      transfer verified to preserve medical history.
- [x] **Phase 6 — Farms & Poultry** (§12): Farm-ID join-code flow (deferred from
      Phase 3) with idempotent / LEFT-rejoin / SUSPENDED-blocked semantics and
      independent per-farm membership; owner join-code rotation; `poultry_flocks`
      entity with farm-scoped CRUD and a DB composite FK pinning every flock to a
      FARM; farm/poultry domain events + audit.
- [x] **Phase 7 — Animal Lifecycle (Lost / Adoption / Mating)** (§13): one
      `animal_publications` table + one PENDING → APPROVED / REJECTED lifecycle;
      owner-only create (server-derived publisher); moderation via
      `AuthorizationService`'s new system-supervisor-domain fallback (ADMIN or the
      ANIMAL domain); APPROVED-only PII-free public browse; per-kind events +
      audit.
- [x] **Phase 8 — Veterinary Medical Care** (§14): the medical CRUD + clinic/vet
      authorization was already delivered in Phase 5; Phase 8 adds only the
      composed read-only **medical-history timeline** (`medical_records` ∪
      `vaccinations`, merged newest-first — no new table / permission / audit /
      events). Follow-ups confirmed absent from the spec.
- [~] **Phase 9 — Appointments & Scheduling: ASSESSED, NOT BUILT** (§21.1). No
  appointment / scheduling / booking / visit concept exists in the confirmed
  specification (`docs/01_SCOPE.md §1.7` scope list, `docs/04_MODULES_FEATURES.md
§4.25` module map, `docs/05_USE_CASES.md` use cases — all silent) and there
  is no legacy schema. Building a schema + state machine + double-booking
  model + permissions from nothing would be inventing a feature, which the
  task and this project forbid ("do not invent business rules the
  specification does not define"). No module, migration, permission, endpoint
  or schema change was made; all Phase 1–8 systems and tests are untouched.
  See §21.1 for the exact spec inputs a future Phase 9 needs.
- [x] **Phase 10 — Veterinary Stores & Products** (§15): product management for
      `VETERINARY_STORE` organizations — one `products` table pinned to the store by
      a composite `(organization_id, organization_type)` FK; five organization
      permissions (`product.read` / `.create` / `.update` / `.delete` /
      `.inventory.adjust`, stock kept separate from update); soft-deactivation only;
      a signed-delta stock endpoint (`currentStock` never trusted from the client);
      `numeric(12,2)` money carried as a decimal string. No new owner / membership /
      approval system — a store _is_ a Phase 3 organization. Category model, product
      images / R2 seam, SKU, the Pet Owner Store domain and Orders / Purchasing are
      deferred (§21.3). **387 tests total.**
- [~] **Phase 11 — Veterinary Jobs / Doctor Offers: ASSESSED, NOT BUILT**
  (§21.2). No jobs / service-request / offer / freelance-marketplace concept
  exists in the confirmed specification — absent from the `docs/01_SCOPE.md §1.7`
  scope list, the `docs/04_MODULES_FEATURES.md §4.25` module map (modules
  4.1–4.24), the `docs/02_ACTORS_ORGANIZATIONS.md §2.6` core-relationships list,
  and all 31 use cases (UC-001–031) in `docs/05_USE_CASES.md`; no legacy schema
  exists in the repo. The only confirmed pet-owner ↔ veterinarian channel
  outside an organization is Consultations (docs 04 §4.16). Building
  `veterinary_requests` + `veterinary_offers`, two lifecycle state machines, an
  acceptance transaction, ~10 permissions, ~9 audit actions and ~9 events from
  nothing would be inventing a major domain, which the task and this project
  forbid. No module, migration, permission, endpoint or schema change was made;
  all Phase 1–10 systems and tests are untouched. See §21.2 for the spec inputs
  a future jobs domain needs.
- [x] **Phase 12 — Chat & Real-Time Messaging** (§16): two confirmed contexts
      only — `PET_OWNER_CLINIC` (Pet Owner ↔ a CLINIC org; any ACTIVE clinic
      member acts on the clinic side) and `FARM_OWNER_MEMBER` (Farm Owner ↔ one
      assigned FARM member). No open group chat, no member↔member. Three tables
      (`conversations`, `conversation_participants`, `messages`); relationship-
      scoped authorization re-evaluated live against current membership/ownership
      (backs HTTP **and** the WebSocket `conversation:<id>` subscription
      authorizer); TEXT messages only; soft delete; per-participant unread
      counts. `chat.*` global permissions granted to NO base role (ADMIN
      override / future delegation). WebSocket auth = the same JWT + user reload
      as REST; ids-only events after commit; no Firebase / push. **429 tests
      total.**
- [x] **Phase 13 — Consultations & Inquiries** (§17): two support-thread
      aggregates sharing one `SupportThreadService` kernel with fully separate
      tables (`consultations`/`consultation_messages`,
      `inquiries`/`inquiry_messages`), permissions, `CONSULTATION`/`INQUIRY`
      supervisor domains, rooms and events. CREATOR access is relationship-scoped
      (`created_by_user_id`); RESPONDER = ADMIN override or an ACTIVE domain
      supervisor who is an approved vet (live check). `OPEN → CLOSED` +
      orthogonal sender-block; message `source` derived, never trusted;
      AI/SYSTEM messages have a null sender (DB CHECK). AI is a seam only —
      `AiResponderPort` + `NoopAiResponder`, admin `ai_settings` flags, AI reply
      generated AFTER commit and swallowing provider errors. Realtime reuses the
      Phase-12 seam. 11 global permissions, 1 migration (3 thread tables +
      `ai_settings`), no new supervisor domain (reuses Phase-2
      `system_supervisor_assignments`). **472 tests total.**
- [x] **Phase 14 — Content Management** (§18): one `contents` aggregate
      (ARTICLE / BOOK / MAGAZINE), `DRAFT → PUBLISHED → ARCHIVED` + soft-delete,
      admin-managed M:N `categories`, and `content_files` metadata backed by the
      Object-Storage abstraction (presigned direct-to-R2 upload; the server owns
      the key; real size/type re-validated on register; best-effort post-commit
      cleanup). Public reads are auth-only and PUBLISHED-only; management needs
      `content.*` (ADMIN or the CONTENT supervisor domain — an approved vet;
      `content.delete` stays ADMIN-only). 8 global permissions, 1 migration
      (`contents` + `content_files` + `categories` + `content_categories`), the
      `CONTENT` supervisor domain populated, a `content:feed` realtime room.
      **520 tests total.**
- [x] **Phase 15 — Notifications & Firebase FCM** (§19): reuses the Phase-1 push
      abstraction (`FirebasePushProvider` + `PushNotificationService` + Firebase
      config) — **no domain module touches `firebase-admin`**. Adds
      `notifications` + `device_push_tokens` + `notification_preferences`, a
      `NotificationEventHandler` (EventBus `ALL_EVENTS` → `NotificationPolicy` →
      in-app row + FCM + realtime `notification.created` on `user:<id>`), the PG
      `DeviceTokenRepository` adapter, a per-user `push_enabled` preference, and
      `POST /admin/notifications` (USER / ROLE / ALL, capped, `notification.admin.send`).
      In-app is the source of truth — FCM / realtime failures never remove a row;
      invalid FCM tokens auto-revoked; `source_event_key` unique index for
      idempotency. 1 migration, 1 global permission, no new supervisor domain.
      **560 tests total.**
- [x] **Phase 16 — Production Hardening & Release Readiness** (§23): a
      system-wide security / reliability / observability / deployment audit with
      **no new product endpoints** and no behaviour change to Phases 1–15.
      Admin APIs (`/api/v1/admin/*` for users, roles, permissions, veterinarians,
      supervisors, organizations, animal-publications, content, notifications,
      audit-logs) were already delivered incrementally across Phases 2–15, so
      Phase 16 hardens rather than adds. Concrete changes: per-node WebSocket
      connection cap (`REALTIME_MAX_CONNECTIONS`, HTTP 503 on excess); per-
      connection Postgres `statement_timeout` (`DB_STATEMENT_TIMEOUT_MS`);
      configurable `DB_SSL_REJECT_UNAUTHORIZED`; container `HEALTHCHECK` on
      `GET /health` (+ compose); `docs/OPERATIONS.md` runbook (backups, restore,
      migration-rollback strategy, DR, required prod config); OpenAPI `0.14.0`
      (125 paths, unchanged). **564 tests total.**

## 21. Open questions / TBD (from the spec — do not invent)

### 21.1 Appointments & Scheduling — deferred (Phase 9 assessment)

The Phase 9 brief asked for an appointment / follow-up scheduling domain, but
**the current product specification does not define one**:

- `docs/01_SCOPE.md §1.7` "Included in Current Scope" — no Appointments,
  Scheduling, Booking or Visits entry.
- `docs/04_MODULES_FEATURES.md §4.25` module map — Veterinary Care is Medical
  Records + Vaccinations only; Clinic Management (§4.6) lists profile / owner /
  members / veterinarians / permissions / subscription / status — nothing about
  appointments.
- `docs/05_USE_CASES.md` — no appointment use case (UC-016 "Manage Medical
  Record" is Vet → Select Clinic → Search Animal → Open Animal → Medical Record,
  with no scheduling step).
- No legacy schema exists in the repo (`docs/` is the authoritative spec).
- "Follow-up": already resolved in Phase 8 §14.1 — the only `متابعة` token in
  `docs/` (`01_SCOPE.md:251`) is a Consultation/Inquiry thread action, not a
  medical or scheduled follow-up. So task §19's "medical follow-up vs scheduled
  appointment" distinction cannot be resolved — **neither concept exists yet**.

Nothing was built. A future Phase 9 needs the spec to first define:

1. **Participants & initiation** — can a Pet Owner request a visit, can a
   Clinic/Vet create one, or both? What relationship is required (an
   `animal_clinic_access` grant? any ACTIVE clinic? an approved vet member?).
2. **Status lifecycle & transitions** — the exact state set and the legal
   transition graph (the project pattern is a small CHECK-constrained enum +
   domain-layer transition rules; see the Phase 7 publication lifecycle).
3. **Scheduling & timezone model** — date/time representation, whether the DB
   stores `timestamptz` slots, and the timezone contract (the project parses
   `date` columns as `YYYY-MM-DD` strings — §11.2 — but has no clock-time
   convention).
4. **Double-booking policy** — which overlaps are prohibited (same vet? same
   clinic room?) and whether a Postgres `btree_gist` exclusion constraint on a
   `tstzrange` is warranted or transactional check-then-insert suffices.
5. **Cancellation policy** — who, when, reason required?, restorable?
6. **Permissions** — an `appointment.*` set in the **organization** RBAC
   catalogue (`organization-rbac.constants.ts`), granted to no role by default
   and surfaced through `authorizeOrg`; plus the owner-side path.
7. **Medical linkage** — optional `medical_record_id` / follow-up reference, only
   if the spec makes appointments part of the medical timeline (§14).

When defined, it slots in as `src/modules/appointments/` (four-layer), reusing
`withOrganization` + `authorizeOrg` for the clinic side, the Phase 4
ownership check for the owner side, `AuditService`, and the `EventBus`
(`appointment.*` events as the notification seam). One `appointments` table with
FKs to `animals` / `organizations` / `users` (`ON DELETE RESTRICT` — historical
appointments survive membership/ownership changes).

### 21.2 Veterinary Jobs / Doctor Offers — deferred (Phase 11 assessment)

The Phase 11 brief asked for a freelance-marketplace domain — a Pet Owner posts a
veterinary service request, approved veterinarians submit competing offers, the
owner accepts one, the selected veterinarian becomes responsible — but **the
current product specification does not define one**:

- `docs/01_SCOPE.md §1.7` "Included in Current Scope" — the complete list of
  in-scope domains has no Jobs, Service Requests, Offers, Bidding or Marketplace
  entry.
- `docs/04_MODULES_FEATURES.md §4.25` "Module Map" and modules 4.1–4.24 — no
  jobs / offers module. The Communication branch is Chat / Consultations /
  Inquiries / Admin Messaging only.
- `docs/05_USE_CASES.md` — 31 use cases (UC-001–031); none is "post a service
  request → receive offers → accept an offer". Pet-owner ↔ veterinarian
  interaction outside an organization is only Consultations (UC-020–023), a
  one-directional AI/supervisor-answered thread, not a multi-party bid.
- `docs/02_ACTORS_ORGANIZATIONS.md §2.6` "Core Relationships" — Pet Owner _owns_
  Animal; Veterinarian _works at_ Clinic/Farm and _can be_ an Organization
  Supervisor. No "requests service from" / "offers on" relationship.
- No legacy schema or old Jobs/Offers implementation exists in the repo (`docs/`
  is the authoritative spec; the project is not even a git repository). Per
  `docs/01_SCOPE.md §1.8`, a legacy feature is only in scope once analysed and
  classified KEEP — with no legacy artifact and no forward spec, a jobs domain
  is **LATER / TBD**.

Nothing was built. A future jobs phase needs the spec to first define:

1. **Terminology & entities** — the confirmed names (request? job? service
   request?), and whether an offer is a distinct aggregate or a status on a
   join row.
2. **Request fields** — title / description / category / animal link / location /
   timing / attachments are all only _examples_ in the brief; the spec confirms
   none. If a request may reference an animal, the Phase 4 ownership rule applies
   (an owner cannot post for another user's animal).
3. **Request lifecycle** — the exact state set and legal transitions (the project
   pattern is a CHECK-constrained enum + domain-layer transition rules; see the
   Phase 7 publication lifecycle).
4. **Offer lifecycle** — states, and whether one veterinarian may submit one
   offer per request (→ a DB unique constraint) or several.
5. **Offer fields** — price (Postgres `numeric`, decimal-string end-to-end, per
   §15.3 money rules), message, duration, availability — again only examples.
6. **Acceptance semantics** — whether losing offers are auto-rejected or the
   owner rejects explicitly; the assigned/selected request state; and the
   row-locking strategy for concurrent accepts (`SELECT … FOR UPDATE` on the
   request row inside the transaction).
7. **Visibility** — which open requests an approved veterinarian may discover,
   and what owner PII / competing-offer data is hidden.
8. **Permissions** — a `veterinary_request.*` / `veterinary_offer.*` set in the
   **global** RBAC catalogue (this domain is not organization-scoped), granted to
   PET_OWNER / VETERINARIAN as appropriate, plus moderator visibility via a
   system-supervisor domain.
9. **Attachments & location** — reuse §7.4 object storage (keys only, no
   binaries in PG) and the established location convention; neither exists yet.

When defined it slots in as `src/modules/veterinary-jobs/` (four-layer), reusing
`authenticate`, `AuthorizationService` + `authorize`, `requireApprovedVeterinarian`
for eligibility, the Phase 4 animal-ownership check when a request references an
animal, `AuditService`, and the `EventBus` (`veterinary_request.*` /
`veterinary_offer.*` ids-only events as the notification seam). Two tables —
`veterinary_requests` (`created_by_user_id → users`, optional `animal_id →
animals ON DELETE SET NULL`) and `veterinary_offers` (`request_id →
veterinary_requests`, `veterinarian_user_id → users`, unique on
`(request_id, veterinarian_user_id)` if one-offer-per-vet is confirmed) — with
`ON DELETE RESTRICT` / soft-close so offer history survives.

### 21.3 Veterinary Store & products — deferred items (Phase 10)

- **Product categories**: docs 04 §4.9 names "Categories" but defines no fields
  or hierarchy. Modelled as the free-form `product_type` CHECK enum
  (`MEDICINE` / `EQUIPMENT` / `SUPPLY` / `OTHER`). A real `product_categories`
  table + nullable `products.category_id` FK is the extension point — no second
  category system was invented, and the dependency is recorded here.
- **Product images / media**: no binaries in Postgres, no R2 wiring (§7.4 storage
  is out of scope until a later phase). A future `product_images` table holding
  object-storage keys is the seam.
- **SKU / barcode**, **multi-currency**, **tax / discount models**: not in the
  spec; add columns + validation when defined.
- **Pet Owner Store products**: a separate future domain — it will get its own
  table, never a discriminator column on `products` (the two stores must not be
  merged).
- **Orders / Purchasing / Cart / Checkout / Payments / store Subscriptions**:
  explicitly out of Phase 10 scope. `products` uses `ON DELETE RESTRICT` and
  soft-deactivation so product history survives for them.
- **Inventory movement ledger**: only a single `stock_quantity` column exists;
  the audit log (`PRODUCT_INVENTORY_ADJUSTED` with `delta` / `previousQuantity` /
  `newQuantity` / `reason`) is the movement history. A dedicated
  `inventory_movements` child table of `products` is the future extension.
- **Public / cross-store product browse**: not confirmed by the spec — products
  are private to the store's members via `authorizeOrg`. Add a public read model
  when specified.
- **Per-product Admin approval**: not in the spec (a store is approved once as an
  organization); not added.
- **Low-stock / reorder thresholds & alerts**: no fields defined; a future
  `reorder_point` column + an `inventory.low_stock` event consumer.

### 21.4 Other open items

- Hospital / Syndicate workflows: out of Phase 3 scope; `organizations.type`
  CHECK currently allows only the four Phase-3 types — extend the migration when
  reached.
- Cattle / sheep farm domain: deferred. `farm_details` is the extension point.
- Subscription plans: none — Admin sets start/end dates per organization.
- Final notification catalogue: derived from use cases in Phase 10.
- **Farm-ID join endpoint**: implemented in Phase 6 (§12.1) —
  `POST /organizations/join`. `farm_details.join_code` (unique) is the only
  farm-specific column; no `farm_members` / `farm_veterinarians` table was added.
- **Poultry sub-domains** (production, mortality, feed logs, flock health,
  per-flock vaccination scheduling): the spec defines no fields, so only
  `poultry_flocks` exists. Each is a future child table of `poultry_flocks`.
- **Cattle / sheep farm operations**: explicitly future (docs 01 §1.7). Reuse the
  FARM org type; add species-specific tables + a policy gate when analysed.
- **Farm join-code visibility**: the code is returned by `GET /organizations/:id`
  to any member holding `organization.read` (Phase 3 behaviour, unchanged) and by
  a dedicated `organization.update`-gated `GET …/join-code`. Tightening the
  Phase-3 response to hide it from plain STAFF is a possible later change.
- **Self-service rejoin after SUSPENDED / REMOVED**: refused (`403`). Only `LEFT`
  members rejoin via the code. If the product wants removed members to rejoin
  freely, relax `FarmPolicy.resolveJoinAction`.
- **Organization owner transfer**: not implemented (spec §20). Org owner is
  preserved; a transfer workflow can be added later without schema change
  (re-point `owner_user_id` + swap OWNER membership rows in a transaction).
  _Animal_ ownership transfer **is** implemented (§10.3).
- **Animal LOST / FOR_ADOPTION / FOR_MATING**: modelled as separate
  `animal_publications` rows (Phase 7 §13), **not** as `animals.status` — the
  animal keeps ACTIVE / DEACTIVATED. Species is a text + CHECK enum, not a
  catalogue table — extend the CHECK via migration when a new species is needed.
- **Publication lifecycle beyond PENDING / APPROVED / REJECTED** (Phase 7): the
  spec (docs 05 UC-005/006/007) confirms only these three. **No owner
  cancellation / withdrawal**, and **no `RESOLVED` / `CLOSED` state** for an
  APPROVED listing whose pet was found / adopted — docs 04 §4.21 mentions a
  generic Suspend / Restore for moderated resources but does not define it for
  publications. Add a status + owner/admin action when the product specifies it.
- **Ownership transfer with a live publication** (spec §18, undefined): a
  transfer does **not** touch existing `animal_publications` rows — they keep
  their `created_by_user_id` snapshot and can still be rejected by a moderator.
  A stale APPROVED listing is not auto-cancelled and its `PENDING` row would
  block the new owner from re-publishing that kind until it is rejected. Auto
  handling on transfer is a deferred product decision (a consumer of the
  existing `animal.ownership.transferred` event could do it later).
- **Animal search by identification number** (task §10): the spec defines no
  microchip / tag field and no global animal search — only the clinic-scoped
  "Search Animal" of docs 05 UC-016, which is Phase 5's `animal_clinic_access`
  patient list. Add a `microchip` column + a search endpoint when specified.
- **System-supervisor permission sets are code, not data**: `SUPERVISOR_DOMAIN_PERMISSIONS`
  is a fixed map (`system_supervisor_assignments` has no per-assignment
  permission column, unlike org supervisors). If the product needs per-assignment
  system-supervisor permissions, add a join table mirroring
  `organization_supervisor_permissions`.
- **Clinic ↔ animal association workflow** (Phase 5): the spec does not define
  how a clinic becomes linked to an animal, so `animal_clinic_access` is granted
  by a clinic-side action (`animal.veterinary.access.manage`) with **no
  owner-consent step**. If the product later requires owner approval, add a
  `PENDING` status + approve/reject to the existing table — no structural change.
- **Non-CLINIC veterinary care** (VETERINARY_OFFICE, FARM/poultry): out of Phase
  5 scope. `VeterinaryCarePolicy.assertVeterinaryOrgType` is the single gate to
  widen. Farm/poultry medical operations are explicitly deferred.
- **Owner-visible vs. internal veterinary fields** (task §10): the spec defines
  no field-level visibility, so the owner DTO currently exposes the same fields
  as the clinic DTO. `toOwnerMedicalRecordDTO` / `toOwnerVaccinationDTO` are the
  redaction seam — no privacy rules were invented.
- **Medical attachments** (docs 04 §4.4): deferred with the rest of file storage
  (R2 is out of scope until a later phase).
- **STAFF org role** seeds with `organization.read` only (no `member.read`).
  Roster visibility for plain staff can be widened later if the product requires.
- **`organization.update` audit**: emitted as `ORGANIZATION_UPDATED` (added to
  the audit catalogue beyond spec §30's minimum list).
- **MODERATOR baseline** (Phase 2 decision, extended in Phase 3): seeded with
  read-only identity + `organization.admin.read` oversight. Broader capability
  comes from explicit grants / supervisor assignments later.
- **Veterinarian role timing** (Phase 2 decision): the `VETERINARIAN` global
  role is granted on _approval_, not on _apply_. The authorization layer gates
  vet capabilities on `veterinarianStatus = APPROVED` regardless, so an admin
  manually granting the role early still yields no vet access.

## 22. Known issues / deferred

- **Dev (`.ts`) and prod (`.js`) migration runners must not share a database.**
  knex records the migration filename _with extension_, so a DB migrated by
  `node dist/database/migrate.js` and then run through `tsx src/database/migrate.ts`
  (or vice-versa) sees every migration as "pending". `disableMigrationsListValidation`
  silences the validation error but not the pending-detection. `npm test` uses
  the `tsx` runner consistently; production uses the compiled runner against its
  own database.
- **Stateless access tokens survive a plain logout** until they expire
  (≤ 15 min). Suspend/deactivate are enforced immediately (status re-checked per
  request); a plain `/auth/logout` only revokes the _refresh_ session. A future
  option is a per-request session-liveness check in `authenticate` (one extra
  indexed query) for near-instant logout. **Phase 16 decision: accepted as-is** —
  the 15-minute window is within policy; suspend/deactivate already cover the
  urgent case.
- `user.delete` permission exists but there is **no destructive delete endpoint**
  — identity records are deactivated, never removed (audit integrity).
- `device_push_tokens` / `notifications` / `notification_preferences` and the PG
  `DeviceTokenRepository` adapter **landed in Phase 15** (§19). Durable FCM
  retry / a broadcast queue and notification retention/cleanup remain future
  items — the event-processing reliability model and its upgrade path are
  documented in `docs/OPERATIONS.md` §6.
- Real-time gateway is single-node (in-memory room index); a Redis-backed
  pub/sub adapter behind the same `RealtimeGateway` interface is the documented
  multi-node path (`docs/OPERATIONS.md` §1). Phase 16 added a per-node
  `REALTIME_MAX_CONNECTIONS` cap (HTTP 503 on excess) so a single node degrades
  predictably.
- `npm audit`: **high / critical** findings are all in the `vitest` / `vite`
  dev-test chain (devDependencies, not shipped). Re-audited Phase 16
  (`npm audit --omit=dev`): **no high/critical in the production tree**; 8
  **moderate** advisories are transitive through `firebase-admin`
  (`@google-cloud/storage` → `teeny-request` → `uuid`) and sit on the Cloud
  Storage path, not the FCM messaging path this project calls. Tracked for a
  `firebase-admin` bump.
- Data-access layer relies on an ESLint override (`*.repository.ts`,
  `src/database/**`) relaxing `no-unsafe-*` — knex's builder chains are typed as
  `any`; types are re-asserted at each repository's mapper boundary.

## 23. Production hardening & release readiness (Phase 16)

Phase 16 was an audit pass, not a feature phase. This section records the
production decisions and the state of each hardening area. Operational
procedures (backup/restore, DR, deploy checklist) live in `docs/OPERATIONS.md`.

### 23.1 What the audit confirmed already holds

| Area                  | Finding                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AuthN                 | HS256 JWT with pinned `alg`, `iss`/`aud` verified (`jose`); user reloaded every request so suspend/deactivate bite immediately; opaque refresh tokens (SHA-256 at rest), rotation with replay-family revocation committed before the error is raised. Per-IP limiter on `/auth/*`. |
| AuthZ                 | One `AuthorizationService` (`isAdmin` / `can` / `assert` + org-scoped `canInOrganization`). Org RBAC is a separate catalogue. Route guards + service-layer re-checks. Supervisor domains gate on `veterinarianStatus = APPROVED` live.                                             |
| IDOR                  | Every owned-resource read/write is scoped by `user_id` / ownership / membership in the query; a foreign id returns 404, not 403 (no existence leak). Chat / consultation / inquiry / notification / device / content-file paths all verified.                                      |
| Input validation      | Zod at every route (`validate({ body, query, params })`), `.strict()` on mutating bodies so server-controlled fields (ownership, status, timestamps) can't be mass-assigned. UUID params validated. Pagination coerced + clamped (`pageSize` ≤ 100).                               |
| Transactions & events | `db.transaction` around every multi-row mutation; audit row written **inside** the same tx; domain event published **after** commit; `InMemoryEventBus` defers handlers to the next microtask so nothing observes an uncommitted write.                                            |
| Realtime              | JWT auth on upgrade; `subscribe` gated by the composite authorizer (`user:<id>` self-only; org / conversation / consultation / inquiry / content-feed rooms scoped like REST); ids-only payloads; 1 MiB frame cap; heartbeat sweep.                                                |
| Storage               | Presigned direct-to-R2 only; **server generates every key**; register re-`HEAD`s the object and re-validates real size / MIME against the allow-list; `sanitizeKey` strips traversal; audit/logs/events never carry keys or URLs.                                                  |
| Secrets               | `src/config` is the only `process.env` reader (grep-verified); fail-fast on partial credential sets; JWT / refresh / passwords / Firebase / R2 values never logged, audited, or returned.                                                                                          |
| Observability         | Structured pino JSON; request-id from inbound `x-request-id` or generated, echoed on the response and on `error.requestId`; 5xx→error / 4xx→warn; immutable `audit_logs`.                                                                                                          |
| Errors                | Single envelope `{ error: { code, message, details?, requestId? } }`; typed `AppError` subclasses → stable codes + status; non-operational errors become a generic message in production; Zod → 422; bad JSON → 400.                                                               |

### 23.2 Changes made in Phase 16

| Change                                                                                                                                                                                                                                                                    | Rationale                                                                                                                            | Default                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `REALTIME_MAX_CONNECTIONS` — per-node cap on concurrent WebSocket connections; excess upgrades get HTTP 503 (checked before and after the auth round-trip).                                                                                                               | The gateway held no ceiling — an unbounded-socket client could exhaust memory / FDs.                                                 | `10000` (`0` disables)                                   |
| `DB_STATEMENT_TIMEOUT_MS` — `SET statement_timeout` once per pooled connection via `pool.afterCreate`.                                                                                                                                                                    | One runaway query could pin a pool slot indefinitely; `acquireConnectionTimeout` only bounds _waiting for_ a slot.                   | `30000` (`0` disables)                                   |
| `DB_SSL_REJECT_UNAUTHORIZED` — was hard-coded `false`.                                                                                                                                                                                                                    | Let deployments with a trusted DB CA turn on chain verification without a code change.                                               | `false` (unchanged behaviour)                            |
| Container `HEALTHCHECK` → `GET /health`, plus a matching `healthcheck` on the compose `api` service.                                                                                                                                                                      | The image declared no liveness probe. Uses Node's global `fetch`, no extra tooling.                                                  | interval 30s / timeout 5s / start-period 20s / retries 3 |
| `docs/OPERATIONS.md` — new runbook.                                                                                                                                                                                                                                       | §18 of the brief: backup/restore, migration-rollback strategy, DR, required prod config, first-run, observability, deploy checklist. | —                                                        |
| Body-parser errors mapped correctly: `BODY_LIMIT` overflow → **413 `PAYLOAD_TOO_LARGE`** (was 500), unsupported charset/encoding → **415 `UNSUPPORTED_MEDIA_TYPE`**, malformed body → 400. Generalised from the old JSON-`SyntaxError`-only branch in `error-handler.ts`. | A payload over `BODY_LIMIT` was falling through to `InternalError` → 500 and logging a stack for what is a client error.             | —                                                        |
| OpenAPI `0.13.0` → `0.14.0`; API description extended for Phases 14–16.                                                                                                                                                                                                   | Signal the hardening release; the doc had drifted (no Phase 14/15 prose). Path count unchanged (125).                                | —                                                        |

### 23.3 Deliberately NOT changed

- **No schema changes.** No migration was added or edited. The audit found the
  existing FKs / unique + partial indexes / CHECK constraints / cascade rules
  sufficient (append-only ownership history, one-current-owner partial unique,
  `source_event_key` idempotency index, composite org-type FKs, etc.).
- **No new endpoints, permissions, roles, events, or audit actions.**
- **Pagination stays offset-based.** Keyset pagination was considered (brief §6);
  current list sizes and the `pageSize ≤ 100` clamp make it unnecessary, and
  changing the response contract would be a breaking change for no measured win.
- **Rate limiting stays global + auth-scoped.** Per-endpoint limits on
  "expensive" routes were considered; the existing global limiter plus the
  `pageSize` clamp and `statement_timeout` cover the abuse cases without
  per-route tuning that would need production traffic data to set well.
- **CORS `*` default kept in code** but `docs/OPERATIONS.md` flags that
  production must set explicit `CORS_ORIGINS` (the `credentials: true` + `*`
  combination is downgraded by browsers anyway).

### 23.4 Accepted limitations (see `docs/OPERATIONS.md` §10)

Single-node realtime fan-out; in-process event bus with no durable retry / DLQ
(Postgres is the source of truth, idempotency keys are already in place for a
future queue); no R2 orphan-object sweep; `JWT_ACCESS_SECRET` rotation is a hard
cutover (no key-id window); no Prometheus / OpenTelemetry; backups are
infrastructure-managed, not application-managed.
