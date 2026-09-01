# Bytari — Veterinary Platform Backend

Central backend for the Veterinary Platform: one API serving the mobile app
(Pet Owner / Veterinarian / Admin-Supervisor modes) and future web clients.

Built from scratch. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design and
[`docs/`](./docs) for the product specification.

> **Status: latest shipped is Phase 16 — Production hardening & release readiness.**
>
> **Backend Gap Audit (pre Mobile Phase 12, shipped):** a full re-audit of the
> Identity / Organizations / Animals / Medical Records / Vaccinations / Poultry /
> Media / Authorization surface against the product spec and every completed
> mobile phase. Every confirmed use case (UC-001…UC-017) was already fully
> supported. The **only** additive change: `GET /users/:id` — an
> authentication-only **name summary** (id + first/last name +
> `veterinarianStatus`; no email / phone / account status / roles) so clients
> can resolve the actor / authorship user ids that DTOs already carry
> (`recordedByUserId`, `createdBy`, `transferredBy`, …) and back
> member/supervisor pickers. No migration; no existing endpoint or DTO changed.
> Medical/animal file attachments and structured treatment entities remain
> spec-acknowledged **future work** (no use case defines the workflow yet).
> **570 tests.**
>
> Phase 16 (shipped): a full security / reliability / observability / deployment
> audit pass — **no new product endpoints**, Phases 1–15 behaviour unchanged.
> Concrete changes: a per-node **WebSocket connection cap**
> (`REALTIME_MAX_CONNECTIONS`, excess upgrades get HTTP 503); a per-connection
> Postgres **`statement_timeout`** (`DB_STATEMENT_TIMEOUT_MS`, default 30s) so one
> runaway query cannot pin a pool slot; a configurable
> **`DB_SSL_REJECT_UNAUTHORIZED`**; a container **`HEALTHCHECK`** on `GET /health`
> (mirrored in `docker-compose`); and a new operations runbook
> ([`docs/OPERATIONS.md`](./docs/OPERATIONS.md)) covering backups / restore /
> migration-rollback strategy / DR / required production configuration. The audit
> confirmed the existing hardening holds: centralized `AuthorizationService`,
> org-scoped realtime rooms, IDOR-safe ownership checks, `commit → EventBus`
> ordering everywhere, in-transaction audit writes, presigned-only uploads with
> server-generated keys, secrets confined to `src/config`, and structured logs
> with request-id correlation. OpenAPI is `0.14.0` (125 paths, unchanged).
>
> Phase 15 (shipped): a centralized notification system on top of the **Phase-1
> push infrastructure** (`PushNotificationProvider` abstraction +
> `FirebasePushProvider` + Firebase config with fail-fast validation) — **no
> domain module imports `firebase-admin`**. Adds `notifications`,
> `device_push_tokens` and `notification_preferences` tables, a PG
> `DeviceTokenRepository` adapter, and a `NotificationEventHandler` that
> subscribes to the existing **EventBus** (`ALL_EVENTS`): each domain event is
> mapped by a central **`NotificationPolicy`** to explicit recipients (sender
> always excluded; resolved from _current_ membership / supervisor / thread
> relationships), then the `NotificationService` writes the **in-app row (source
> of truth)**, publishes `notification.created` on the recipient's `user:<id>`
> realtime room, and attempts FCM push. **FCM / realtime failures never remove a
> notification row**; invalid FCM tokens are auto-revoked; a per-user
> `push_enabled` preference gates push only (in-app is always created). A
> `source_event_key` unique index makes repeated event processing idempotent.
> `POST /admin/notifications` (`notification.admin.send`) broadcasts to a
> `USER` / `ROLE` / `ALL` target, capped at 5000, FCM fan-out detached from the
> response. **No real FCM in tests** (a `FakePushProvider` is injected) —
> documented; durable retry / a broadcast queue are future items.
>
> Phase 14 (shipped): one `contents` aggregate — **ARTICLE / BOOK / MAGAZINE**
> (docs 04 §4.23) — with a `DRAFT → PUBLISHED → ARCHIVED` lifecycle plus
> project-standard soft-delete, admin-managed M:N **categories**, and file
> **metadata** in `content_files` backed by the Phase-1 **Object Storage / R2
> abstraction** (no bytes in PostgreSQL). Upload is **presigned direct-to-R2**:
> request a URL (server generates the storage key — the client never chooses it),
> `PUT` the bytes, then register (the server `HEAD`s the object and re-validates
> its **real** size / MIME against the allow-list). MAIN/COVER replace supersedes
> the prior file; the old object is deleted best-effort **after commit** — a
> storage failure there is logged, never rolled back. The public read endpoints
> are authenticated-only and show **only PUBLISHED, non-deleted** items (public
> file DTOs omit the storage key; downloads go through a signed / CDN-URL route). Management (`/admin/content…`) needs `content.*` — the **ADMIN
> override** or the **CONTENT system-supervisor domain** (reusing Phase-2
> `system_supervisor_assignments`, no new role; the supervisor must be an
> approved vet, checked live). `content.delete` (soft-delete / restore) is
> **ADMIN-only**. Search is a Postgres generated `tsvector` + GIN index (no
> unbounded ILIKE). Realtime `content:feed` room for Admin / Content Supervisor
> clients. **No real R2 e2e in tests** (mocked storage) — documented; **no
> Firebase / notifications**.
>
> Phase 13 (shipped): the two support-thread workflows the spec confirms (docs 05
> §5.18–5.19, UC-020…UC-027) — a Pet Owner **Consultation** (any authenticated
> user; optional owned-animal reference) and an approved-Veterinarian **Inquiry**
> (non-vets / pending vets rejected). They share one `SupportThreadService`
> kernel but keep fully separate tables
> (`consultations`/`consultation_messages`, `inquiries`/`inquiry_messages`),
> permissions, supervisor domains, realtime rooms and events. Access is
> relationship-scoped: the **CREATOR** always reads and may post while `OPEN` and
> not sender-blocked; a **RESPONDER** is the ADMIN override or an ACTIVE
> `CONSULTATION`/`INQUIRY` system-supervisor (reusing Phase-2
> `system_supervisor_assignments`, no new role) who is an approved vet — checked
> live, so a `CONSULTATION` supervisor can't touch inquiries and a revoked
> assignment loses access immediately. `OPEN → CLOSED` (terminal;
> supervisor/admin) plus an orthogonal **block-sender** (mutes the creator, thread
> stays open — UC-023/027). Message `source` (`USER`/`SUPERVISOR`/`ADMIN`/`AI`/
> `SYSTEM`) is derived from `req.auth`, never the body; AI/SYSTEM messages have a
> null sender (DB CHECK — no AI impersonation). **AI is a seam only** —
> `AiResponderPort` + `NoopAiResponder`, admin `ai_settings` on/off flags, the AI
> reply generated **after** the create transaction commits and provider errors
> swallowed (the thread is never corrupted). **No real AI provider, no Firebase**
> in this phase. Realtime (`consultation:<id>` / `inquiry:<id>`) reuses the
> Phase-12 WebSocket seam.
>
> Phase 12 (shipped): the two chat contexts the spec confirms (docs 01 §9,
> UC-018 / UC-019) — **`PET_OWNER_CLINIC`** (a pet owner ↔ a CLINIC organization;
> any ACTIVE clinic member acts on the clinic side, not one specific vet) and
> **`FARM_OWNER_MEMBER`** (the farm owner ↔ one assigned FARM veterinarian /
> employee). No open group chat, no member↔member. Three tables
> (`conversations`, `conversation_participants`, `messages`); access is
> **relationship-scoped** and re-checked live against current
> membership/ownership on every request (a suspended / removed member loses
> access immediately) — the same check backs the WebSocket `conversation:<id>`
> subscription authorizer. TEXT messages only; soft delete; per-participant
> unread counts. WebSocket auth reuses the REST JWT verification (no second login);
> ids-only domain events after commit; **no Firebase / push** (the events are the
> future notification seam). `chat.*` global permissions are granted to no base
> role — like Phase 4 `animal.*`, they exist for the ADMIN override / future
> Communication-Supervisor. **Not** built: media/file messages, message editing,
> per-clinic-member read receipts, clinic-internal or office/store chat.
>
> Phase 10 (shipped): product management for `VETERINARY_STORE` organizations.
> A Veterinary Store **is** an Organization of type `VETERINARY_STORE` (Phase 3) —
> no new owner / membership / approval system. Adds one table (`products`), pinned
> to its store by a composite organization-id + organization-type FK; five
> organization permissions (`product.read` / `product.create` / `product.update` /
> `product.delete` / `product.inventory.adjust` — stock kept separate from
> update); soft-deactivation only (`status = INACTIVE`, never physically deleted —
> future Orders will reference product history); and a dedicated signed-delta
> stock endpoint (`currentStock` is never trusted from the client). Money is
> `numeric(12,2)` carried as a decimal **string** end-to-end — no floating point.
> Products are private to the store's members — **no public browse**. **Not** in
> this phase and deliberately deferred: a category model (kept as a free-form
> `product_type` enum — `ARCHITECTURE.md` records the dependency), product images
> / an R2 upload seam, SKU / barcode, multi-currency, the separate Pet Owner Store
> product domain, Orders / Purchasing / Cart / Checkout / Payments /
> Subscriptions, and an inventory-movement ledger (the audit log is the movement
> history).
>
> Phase 11 (Veterinary Jobs / Doctor Offers) was assessed and deferred: there is
> **no jobs / service-request / offer / freelance-marketplace concept in the
> confirmed product specification**. It appears in none of: the scope list
> (`01_SCOPE.md` §1.7), the module map and modules 4.1–4.24
> (`04_MODULES_FEATURES.md`), the core-relationships list
> (`02_ACTORS_ORGANIZATIONS.md` §2.6), or the 31 use cases (`05_USE_CASES.md`
> UC-001–031); and no legacy schema exists in the repo. The only confirmed
> pet-owner ↔ veterinarian channel outside an organization is **Consultations**
> (`04_MODULES_FEATURES.md` §4.16). **No module, migration, permission, endpoint
> or schema change was made** for Phase 11; `ARCHITECTURE.md` §21.2 records the
> spec inputs a future jobs domain would need.
>
> Phase 9 (Appointments & Scheduling) was assessed and deferred: there is **no
> appointment / scheduling / booking / visit concept in the confirmed product
> specification** — `docs/01_SCOPE.md §1.7`, `docs/04_MODULES_FEATURES.md §4.25`
> and `docs/05_USE_CASES.md` are all silent, and there is no legacy schema.
> **No module, migration, permission, endpoint or schema change was made** for
> Phase 9; `ARCHITECTURE.md §21.1` records the exact spec inputs a future Phase 9
> needs.
>
> Phase 8 (shipped): the medical domain — **Medical Records** (with `diagnosis` /
> `treatment` / `notes` as fields), **Vaccinations**, the `animal_clinic_access`
> grant and the whole clinic → authorized veterinarian → animal authorization
> gate — was delivered in **Phase 5**; Phase 8 added the composed read-only
> **Medical History timeline** (`GET …/medical-history`) merging the existing
> `medical_records` + `vaccinations` rows (no new table / permission / audit /
> events). Medical **Follow-ups** and standalone **Diagnoses / Treatments**
> tables are not in the confirmed spec.
>
> Phase 7 (still present): animal lifecycle publications (Lost / Adoption /
> Mating) with a PENDING → APPROVED / REJECTED moderation lifecycle.
>
> Phase 6 (still present): Farm-ID join-code flow + poultry flock management for
> `FARM` organizations.
>
> Phase 5 (still present): veterinary care — `animal_clinic_access` grants,
> clinic-scoped medical records & vaccinations, owner-facing read-only history.
>
> Phase 4 (still present): Animal Core + append-only `animal_ownerships` history
> with a partial unique index for one-current-owner, transactional transfer.
>
> Phase 3 (still present): unified `organizations` aggregate (CLINIC / FARM /
> VETERINARY_OFFICE / VETERINARY_STORE), approval lifecycle, membership model
> (OWNER / VETERINARIAN / SUPERVISOR / STAFF), separate organization RBAC
> catalogue, per-supervisor selected permissions, org-scoped `AuthorizationService`.

## Requirements

- Node.js 20 LTS
- Docker + Docker Compose (for local PostgreSQL)

## Quick start

```bash
cp .env.example .env
npm install

# Start PostgreSQL (host port 5435 by default)
docker compose up -d db

npm run db:migrate      # apply migrations
npm run db:seed         # seed roles + permissions (+ optional bootstrap admin)

npm run dev             # start API on http://localhost:3000
```

Set `JWT_ACCESS_SECRET` (≥ 32 chars) in `.env`. It is **required** in
production; in development an ephemeral per-process secret is generated with a
warning. Optionally set `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` to
have `db:seed` create an ADMIN account (credentials come only from the
environment — nothing is hardcoded).

Verify:

```bash
curl -s localhost:3000/health           | jq
curl -s localhost:3000/health/ready     | jq
open  http://localhost:3000/docs        # Swagger UI

# register → returns { user, tokens }
curl -s -XPOST localhost:3000/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"a-strong-password","firstName":"Pat","lastName":"Owner"}' | jq
```

## Run everything in Docker

```bash
docker compose --profile full up --build
# API on http://localhost:3000, migrations applied on container start
```

The `api` image build runs `npm ci`, so the Docker builder needs network access
to the npm registry. `docker compose up -d db` (Postgres only) has no such
requirement.

## Scripts

| Script                           | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `npm run dev`                    | Watch-mode dev server (tsx)                          |
| `npm run build`                  | Compile TypeScript to `dist/`                        |
| `npm start`                      | Run compiled server                                  |
| `npm run typecheck`              | `tsc --noEmit`                                       |
| `npm run lint`                   | ESLint (type-checked)                                |
| `npm run format`                 | Prettier write                                       |
| `npm test`                       | Migrate, then run Vitest (unit + integration)        |
| `npm run test:unit`              | Unit tests only (no DB required)                     |
| `npm run test:integration`       | Migrate, then run integration tests (needs Postgres) |
| `npm run test:coverage`          | Coverage report                                      |
| `npm run db:migrate`             | Apply pending migrations                             |
| `npm run db:rollback`            | Roll back the last migration batch                   |
| `npm run db:status`              | Show current migration version                       |
| `npm run db:seed`                | Run seed files                                       |
| `npm run db:seed:dev`            | Seed development personas (dev-only, see docs/DEV_SEED.md) |
| `npm run db:migrate:make <name>` | Generate a new migration from the stub               |

`npm test` / `npm run test:integration` need a **separate** `.env.test`
pointing at its own database (e.g. `bytari_test`) — copy `.env.example`,
change `DB_NAME`. Integration tests truncate `users` (cascading) between
runs; without `.env.test` they'll run against whatever `.env` points at.

## API surface

Infra: `GET /`, `GET /health`, `GET /health/ready`, `GET /openapi.json`, `GET /docs`.
Health routes are also served under the version prefix (`/api/v1/health`).
`GET /` includes an `infrastructure` summary (realtime / push / storage providers).

### Phase 2 — identity & authorization (all under `/api/v1`)

| Method | Path                                     | Auth   | Permission             |
| ------ | ---------------------------------------- | ------ | ---------------------- |
| POST   | `/auth/register`                         | public | —                      |
| POST   | `/auth/login`                            | public | —                      |
| POST   | `/auth/refresh`                          | public | — (refresh token)      |
| POST   | `/auth/logout`                           | bearer | —                      |
| POST   | `/auth/logout-all`                       | bearer | —                      |
| GET    | `/auth/me`                               | bearer | —                      |
| GET    | `/users/:id`                             | bearer | — (name summary only)  |
| POST   | `/veterinarians/apply`                   | bearer | —                      |
| GET    | `/veterinarians/me/status`               | bearer | —                      |
| GET    | `/admin/users`                           | bearer | `user.read`            |
| POST   | `/admin/users`                           | bearer | `user.create`          |
| GET    | `/admin/users/:id`                       | bearer | `user.read`            |
| PATCH  | `/admin/users/:id`                       | bearer | `user.update`          |
| POST   | `/admin/users/:id/suspend`               | bearer | `user.suspend`         |
| POST   | `/admin/users/:id/activate`              | bearer | `user.activate`        |
| POST   | `/admin/users/:id/deactivate`            | bearer | `user.deactivate`      |
| POST   | `/admin/users/:id/roles`                 | bearer | `role.assign`          |
| DELETE | `/admin/users/:id/roles/:roleKey`        | bearer | `role.assign`          |
| GET    | `/admin/roles`, `/admin/roles/:key`      | bearer | `role.read`            |
| GET    | `/admin/permissions`                     | bearer | `permission.read`      |
| POST   | `/admin/roles/:key/permissions`          | bearer | `permission.assign`    |
| DELETE | `/admin/roles/:key/permissions/:permKey` | bearer | `permission.assign`    |
| GET    | `/admin/veterinarians/pending`           | bearer | `veterinarian.read`    |
| POST   | `/admin/veterinarians/:userId/approve`   | bearer | `veterinarian.approve` |
| POST   | `/admin/veterinarians/:userId/reject`    | bearer | `veterinarian.reject`  |
| GET    | `/admin/supervisors`                     | bearer | `supervisor.read`      |
| POST   | `/admin/supervisors`                     | bearer | `supervisor.assign`    |
| DELETE | `/admin/supervisors/:id`                 | bearer | `supervisor.remove`    |
| GET    | `/admin/audit-logs`                      | bearer | `audit.read`           |

**ADMIN bypasses per-permission checks** via the central authorization override.
`MODERATOR` seeds with read-only identity + organization oversight
(`user.read`, `role.read`, `permission.read`, `veterinarian.read`,
`supervisor.read`, `audit.read`, `organization.admin.read`); `PET_OWNER` /
`VETERINARIAN` seed with no global permissions. Veterinarian-only capabilities
also require `veterinarianStatus = APPROVED` (enforced by the authorization
layer, not just the role).

### Phase 3 — organizations (all under `/api/v1`)

Member-facing routes are **organization-scoped**: `:organizationId` is resolved
from the URL, and `authorizeOrg(<perm>)` checks the caller's ACTIVE membership +
org role/permissions for _that_ organization (OWNER = full org access; ADMIN =
override; non-`ACTIVE` orgs are restricted for non-admins).

| Method | Path                                                                                                                   | Guard                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| POST   | `/organizations`                                                                                                       | auth (approved vet for CLINIC/FARM) |
| GET    | `/organizations`                                                                                                       | auth (self-scoped)                  |
| GET    | `/organizations/:organizationId`                                                                                       | org `organization.read`             |
| PATCH  | `/organizations/:organizationId`                                                                                       | org `organization.update`           |
| POST   | `/organizations/:organizationId/leave`                                                                                 | auth (non-owner member)             |
| GET    | `/organizations/:organizationId/members`                                                                               | org `member.read`                   |
| POST   | `/organizations/:organizationId/members`                                                                               | org `member.add`                    |
| GET    | `/organizations/:organizationId/members/:memberId`                                                                     | org `member.read`                   |
| PATCH  | `/organizations/:organizationId/members/:memberId`                                                                     | org `member.update`                 |
| DELETE | `/organizations/:organizationId/members/:memberId`                                                                     | org `member.remove`                 |
| GET    | `/organizations/:organizationId/supervisors`                                                                           | org `supervisor.read`               |
| POST   | `/organizations/:organizationId/supervisors`                                                                           | org `supervisor.assign`             |
| PATCH  | `/organizations/:organizationId/supervisors/:membershipId`                                                             | org `supervisor.assign`             |
| DELETE | `/organizations/:organizationId/supervisors/:membershipId`                                                             | org `supervisor.remove`             |
| GET    | `/admin/organizations`, `/admin/organizations/pending`, `/admin/organizations/:id`, `/admin/organizations/:id/members` | global `organization.admin.read`    |
| POST   | `/admin/organizations/:id/approve` · `/reject`                                                                         | global `organization.admin.approve` |
| POST   | `/admin/organizations/:id/suspend` · `/activate` · `/deactivate`                                                       | global `organization.admin.status`  |
| DELETE | `/admin/organizations/:id/members/:memberId` · `/supervisors/:memberId`                                                | global `organization.admin.manage`  |

Organization roles: **OWNER** (empty — full access via owner override),
**VETERINARIAN** (`organization.read`, `member.read`, `organization.veterinarian.read`),
**SUPERVISOR** (empty — the owner selects permissions per assignment), **STAFF**
(`organization.read`). Creating/owning a **CLINIC** or **FARM** requires
`veterinarianStatus = APPROVED`; **VETERINARY_OFFICE** / **VETERINARY_STORE** do
not. FARMs get a `details.joinCode` (the concrete Farm-ID join endpoint is
deferred). The owner can never leave / be removed (organizations never become
ownerless); organizations are never physically deleted.

### Phase 4 — animals & ownership (all under `/api/v1`)

Individual-animal routes are **ownership-scoped**: `:animalId` is resolved from
the URL by `withAnimal`, then `authorizeAnimalWrite()` / `authorizeAnimalRead()`
checks the caller against the animal's **current owner** (the single open row in
`animal_ownerships`). The global **ADMIN** override still applies. A caller who
is neither gets **`404`** (existence is not revealed — deliberate divergence
from Phase 3's `403`, see `ARCHITECTURE.md`). Veterinarians get **no** implicit
access to animals. The collection routes are self-scoped (the caller's own
animals only — ADMIN included).

| Method | Path                                    | Guard                                  |
| ------ | --------------------------------------- | -------------------------------------- |
| POST   | `/animals`                              | auth (caller becomes owner)            |
| GET    | `/animals`                              | auth (self-scoped list)                |
| GET    | `/animals/:animalId`                    | current owner or ADMIN                 |
| PATCH  | `/animals/:animalId`                    | current owner or ADMIN (animal ACTIVE) |
| DELETE | `/animals/:animalId`                    | current owner or ADMIN (soft-delete)   |
| POST   | `/animals/:animalId/ownership/transfer` | current owner or ADMIN                 |
| GET    | `/animals/:animalId/ownership/history`  | current owner or ADMIN                 |

**Ownership model.** Ownership is **not** a column on `animals`. Each ownership
period is a row in `animal_ownerships` with `started_at` / `ended_at`; the
current owner is the row where `ended_at IS NULL`. A partial unique index
(`uq_animal_current_ownership ON animal_ownerships (animal_id) WHERE ended_at IS
NULL`) makes "two current owners" impossible at the database level, and every
animal always has exactly one (the creator's row is opened in the same
transaction as the animal). **Transfer** is a domain operation, never a column
update: validate the target (must exist, be active, and not already be the
current owner) → close the current interval → open a new one → write the audit
record — all in one transaction — then publish `animal.ownership.transferred`
after commit. Only the current owner (or ADMIN) can initiate it; the previous
owner is always taken from the server, never the request body. Client-supplied
`ownerId` / `ownershipId` / `status` / `createdBy` on create, and
`currentOwnerUserId` / ownership fields on update/transfer, are ignored.
Deactivation (`DELETE`) is a soft-delete (`status = DEACTIVATED`, idempotent)
and leaves ownership history untouched; a deactivated animal rejects updates and
transfers with `409 ANIMAL_NOT_ACTIVE`.

New global permissions `animal.read`, `animal.create`, `animal.update`,
`animal.delete`, `animal.ownership.read`, `animal.ownership.transfer` exist for
the ADMIN override and a future delegated Animal-Supervisor role; **no role is
granted any of them by default** — normal access is purely ownership-based.
Domain events: `animal.created`, `animal.updated`, `animal.deactivated`,
`animal.ownership.transferred` (ids-only payloads, published post-commit).

### Phase 5 — veterinary care & medical records (all under `/api/v1`)

Two entities — **medical records** and **vaccinations** — form the animal's
shared **veterinary history**. They are never owned by the recording
veterinarian and survive membership / ownership changes untouched (FKs to
`animals` / `organizations` are `ON DELETE RESTRICT`; the recording user is
`ON DELETE SET NULL`).

**Access model** (clinic-facing routes): `authenticate → withOrganization →
authorizeOrg(<org permission>) → withVeterinaryAnimalAccess`. The last step is a
dedicated gate: the clinic in the URL must hold an **ACTIVE `animal_clinic_access`
grant** for the animal (ADMIN bypasses). A clinic member without a grant — even
an APPROVED veterinarian — gets **`404`**. A clinic **with** a grant reads the
animal's **complete** cross-clinic history, but `PATCH` / `DELETE` only affect
entries **it recorded** (`organization_id` match; otherwise `404`).

| Method               | Path                                                                           | Guard (org permission + access gate)                    |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| GET                  | `/organizations/:organizationId/animal-access`                                 | `animal.veterinary.access.read`                         |
| POST                 | `/organizations/:organizationId/animal-access`                                 | `animal.veterinary.access.manage` (CLINIC only)         |
| DELETE               | `/organizations/:organizationId/animal-access/:animalId`                       | `animal.veterinary.access.manage`                       |
| GET / POST           | `/organizations/:organizationId/animals/:animalId/medical-records`             | `medical_record.read` / `medical_record.create` + grant |
| GET / PATCH / DELETE | `/organizations/:organizationId/animals/:animalId/medical-records/:recordId`   | `medical_record.read` / `.update` / `.delete` + grant   |
| GET / POST           | `/organizations/:organizationId/animals/:animalId/vaccinations`                | `vaccination.read` / `vaccination.create` + grant       |
| GET / PATCH / DELETE | `/organizations/:organizationId/animals/:animalId/vaccinations/:vaccinationId` | `vaccination.read` / `.update` / `.delete` + grant      |
| GET (read-only)      | `/animals/:animalId/medical-records[/:recordId]`                               | animal **owner** or ADMIN (Phase 4 guard)               |
| GET (read-only)      | `/animals/:animalId/vaccinations[/:vaccinationId]`                             | animal **owner** or ADMIN                               |

New **organization** permissions (Phase 5): `animal.veterinary.access.read`,
`animal.veterinary.access.manage`, `medical_record.{read,create,update,delete}`,
`vaccination.{read,create,update,delete}`. The **VETERINARIAN** org role gets the
read + full CRUD on records/vaccinations plus `animal.veterinary.access.read`;
deciding **which** animals a clinic takes on (`animal.veterinary.access.manage`)
stays an OWNER / assigned-SUPERVISOR action so a veterinarian never gains blanket
access. No **global** permissions were added. Domain events (ids-only,
post-commit): `veterinary_access.{granted,revoked}`,
`medical_record.{created,updated,deleted}`, `vaccination.{created,updated,deleted}`.

### Phase 6 — farms & poultry (all under `/api/v1`)

A Farm is an `organizations` row of type `FARM` — everything about the farm
_organization_ (create / approve / profile / members / supervisors) is the
Phase 3 API. Phase 6 adds only:

| Method               | Path                                                     | Guard                                                       |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| POST                 | `/organizations/join`                                    | auth + **APPROVED veterinarian** (no org membership needed) |
| GET                  | `/organizations/:organizationId/join-code`               | `organization.update` (FARM only)                           |
| POST                 | `/organizations/:organizationId/join-code/regenerate`    | `organization.update` (FARM only)                           |
| GET / POST           | `/organizations/:organizationId/poultry/flocks`          | `farm.poultry.read` / `farm.poultry.create` (FARM only)     |
| GET / PATCH / DELETE | `/organizations/:organizationId/poultry/flocks/:flockId` | `farm.poultry.read` / `.update` / `.delete` (FARM only)     |

**Join flow** (`POST /organizations/join`, body `{ joinCode }`): the code is
resolved to a farm (`farm_details.join_code`, unique; case-insensitive input);
the farm must be `ACTIVE`; a transaction creates — or reactivates a `LEFT` —
`VETERINARIAN` membership in `organization_memberships`, writes
`FARM_MEMBER_JOINED` audit, then publishes `farm.member.joined`. An existing
`ACTIVE` member gets `200` with the current membership (no duplicate); a
`SUSPENDED` / `REMOVED` member gets `403` (self-service rejoin is not allowed).
`organizationId` / `ownerId` are never taken from the body. Regeneration rotates
the code (old code stops working immediately) and is `organization.update`-gated.

**Poultry**: `poultry_flocks` is the single confirmed poultry entity (a
batch/flock — `name`, `bird_type`, `bird_count`, `arrival_date`, `status`
ACTIVE/CLOSED, `notes`). Every flock belongs to exactly one FARM, enforced at
the DB by a **composite foreign key** `(organization_id, organization_type) →
organizations(id, type)` with `organization_type` CHECK-pinned to `'FARM'`.
Every lookup is `organization_id`-scoped, so a member of Farm B gets `404` for a
Farm A flock id (and `403` for Farm A routes they are not a member of). Content
edits require an ACTIVE flock (`409 POULTRY_FLOCK_NOT_ACTIVE` otherwise); a
status-only `PATCH` may re-open a CLOSED flock.

New **organization** permissions (Phase 6): `farm.poultry.{read,create,update,delete}`
— **VETERINARIAN** gets full CRUD, **STAFF** gets `farm.poultry.read`, OWNER via
override, SUPERVISOR via owner selection. No **global** permissions; the join
flow needs none (it is gated on APPROVED-vet status). Domain events (ids-only,
post-commit): `farm.member.joined`, `farm.join_code.regenerated`,
`poultry.flock.{created,updated,deleted}`.

### Phase 7 — animal lifecycle publications (all under `/api/v1`)

Animal Core / ownership / transfer / history are **Phase 4**; the clinic↔animal
relationship is **Phase 5** — Phase 7 adds only Lost / Adoption / Mating
publications. One `animal_publications` table with a `kind` discriminator and
one reusable `PENDING → APPROVED / REJECTED` lifecycle.

| Method | Path                                                | Guard                                                    |
| ------ | --------------------------------------------------- | -------------------------------------------------------- |
| POST   | `/animals/:animalId/publications`                   | current **owner** only (server-derived; no ADMIN bypass) |
| GET    | `/animals/:animalId/publications[/:publicationId]`  | owner / ADMIN / ANIMAL supervisor — all statuses         |
| GET    | `/animal-publications[?kind=]`                      | any authenticated user — **APPROVED only**, no owner PII |
| GET    | `/animal-publications/:publicationId`               | any authenticated user — 404 unless APPROVED             |
| GET    | `/admin/animal-publications[?kind=&status=]`        | `animal.read` (ADMIN or ANIMAL supervisor)               |
| GET    | `/admin/animal-publications/:publicationId`         | `animal.read`                                            |
| POST   | `/admin/animal-publications/:publicationId/approve` | `animal.approve`                                         |
| POST   | `/admin/animal-publications/:publicationId/reject`  | `animal.reject` (body `{ reason }`)                      |

**Ownership & moderation model.** The publisher is always the animal's current
owner (`created_by_user_id`, server-set — client `status` / `reviewedBy` /
`ownerUserId` etc. are stripped by Zod). The animal must be `ACTIVE`. At most one
`PENDING` publication of a kind per animal (partial unique index → `409
PUBLICATION_ALREADY_OPEN`). A `CHECK` enforces that a reviewed row has a
reviewer + timestamp and a PENDING row has neither. Moderation runs through
`AuthorizationService.can()`, which now grants a permission held via an **ACTIVE
system-supervisor domain** (docs 03 §3.10) as a fallback after global roles —
the `ANIMAL` domain implies `animal.{read,update,approve,reject}`. A wrong-domain
supervisor or the owner get `403`; re-reviewing a non-`PENDING` publication is
`409 PUBLICATION_NOT_PENDING`.

New **global** permissions (Phase 7): `animal.approve`, `animal.reject` — held by
**no base role**, only ADMIN (override) or the `ANIMAL` supervisor domain.
Domain events (ids-only, post-commit): `animal.{lost,adoption,mating}.{created,approved,rejected}`.
Audit actions: `LOST_ANIMAL_{CREATED,APPROVED,REJECTED}`, `ADOPTION_*`, `MATING_*`.

### Phase 8 — veterinary medical care: medical history timeline (all under `/api/v1`)

The medical CRUD (`medical_records` + `vaccinations`), the `animal_clinic_access`
grant, and the clinic → veterinarian → animal authorization gate are **Phase 5**
(section above) and are unchanged. Phase 8 adds one endpoint pair — a composed,
read-only **medical history timeline** merging both tables newest-first:

| Method | Path                                                               | Guard                                                                                                                     |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/organizations/:organizationId/animals/:animalId/medical-history` | `medical_record.read` in the clinic **+** ACTIVE veterinary-access grant (same gate as the records list; ADMIN overrides) |
| GET    | `/animals/:animalId/medical-history`                               | animal **owner** or ADMIN (Phase 4 `withAnimal` guard)                                                                    |

Query: `page`, `pageSize`, optional `type=MEDICAL_RECORD|VACCINATION`. Each entry
is `{ type, occurredOn, organizationId, recordedByUserId, createdAt,
medicalRecord? | vaccination? }` (the matching sub-object is the existing Phase 5
DTO). **No migration, no new table, no new permission, no audit, no events** —
it is a pure read projection. A clinic with a grant sees the animal's complete
cross-clinic history; a clinic without one gets `404`.

**Not implemented** (not in the confirmed spec): medical **Follow-ups** (the only
"متابعة" reference in `docs/` is a consultation-thread action, not a medical
one); standalone **Diagnoses / Treatments** tables (they are `medical_records`
fields — docs 04 §4.4). Owner medical-record write access is intentionally absent
(spec confirms only that vets manage records without owner approval).

### Phase 10 — veterinary store products (all under `/api/v1`)

A Veterinary Store **is** an Organization of type `VETERINARY_STORE` (Phase 3):
its creation, approval, profile, members and supervisors are the Phase 3
organization endpoints. Phase 10 adds only product management. Every route runs
`authenticate → withOrganization → withVeterinaryStore (400 if the org is not a
VETERINARY_STORE) → authorizeOrg(<permission>) → [withProduct for :productId]`.
The store is always resolved from the `:organizationId` route param;
`organizationId` / `createdBy` / `ownerUserId` / `stockQuantity` / `status` in a
request body are ignored.

| Method | Path                                                       | Permission                 | Notes                                                                                                                      |
| ------ | ---------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/organizations/:organizationId/products`                  | `product.read`             | Paginated. Filters `status`, `type`, `search`; `sort=name\|price\|createdAt`, `order=asc\|desc` (default `createdAt` desc) |
| POST   | `/organizations/:organizationId/products`                  | `product.create`           | `stockQuantity` here is opening stock only                                                                                 |
| GET    | `/organizations/:organizationId/products/:productId`       | `product.read`             | A product id not under this store → `404` (cross-store isolation)                                                          |
| PATCH  | `/organizations/:organizationId/products/:productId`       | `product.update`           | Profile fields + `status` only — never `organizationId` or stock                                                           |
| DELETE | `/organizations/:organizationId/products/:productId`       | `product.delete`           | Soft-deactivate (`status = INACTIVE`); idempotent; row is kept                                                             |
| POST   | `/organizations/:organizationId/products/:productId/stock` | `product.inventory.adjust` | Body `{ delta (signed, non-zero), reason? }`; result may not go < 0 (`409`)                                                |

Product model: `{ id, organizationId, name, description?, productType
(MEDICINE\|EQUIPMENT\|SUPPLY\|OTHER), price (decimal string `numeric(12,2)` or
null — never a float), stockQuantity, status (ACTIVE\|INACTIVE), createdByUserId?,
createdAt, updatedAt }`. Types + Zod + Postgres `CHECK` all pin the two enums and
`price >= 0` / `stock_quantity >= 0`.

Org permissions: **STAFF** gets `product.read` by default; create / update /
delete / inventory stay with the OWNER override or an **explicitly assigned**
SUPERVISOR (a Supervisor gets no product permission automatically). Stock changes
require `product.inventory.adjust` — a permission distinct from `product.update`,
so read/write of the catalogue and stock control can be delegated separately.

Domain events (ids-only, post-commit): `product.created`, `product.updated`,
`product.deactivated`, `inventory.adjusted`. Audit actions (in the same
transaction, ids only, never secrets): `PRODUCT_CREATED`, `PRODUCT_UPDATED`,
`PRODUCT_DEACTIVATED`, `PRODUCT_INVENTORY_ADJUSTED` (metadata carries `delta`,
`previousQuantity`, `newQuantity`, `reason`).

**Not implemented** (not in the confirmed spec — see `ARCHITECTURE.md`): a
category model (kept as the free-form `product_type` enum), product images / an
R2 upload seam, SKU / barcode, multi-currency, public / cross-store product
browse, an `inventory_movements` ledger (the audit log is the movement history),
and the separate **Pet Owner Store** product domain. Orders, Purchasing, Cart,
Checkout, Payments and Subscriptions are out of scope for this phase.

### Phase 12 — chat & real-time messaging (all under `/api/v1`)

Two conversation contexts only (docs 01 §9, UC-018 / UC-019): `PET_OWNER_CLINIC`
(pet owner ↔ a CLINIC org — any ACTIVE clinic member acts on the clinic side) and
`FARM_OWNER_MEMBER` (farm owner ↔ one assigned FARM member). Access is
**relationship-scoped** and re-evaluated live on every request against current
membership / ownership; a caller with no relationship gets `404` (ids never
leak). There is no global permission gate — every authenticated user may hold
conversations, but only for the spec's relationships.

| Method | Path                                           | Who                                                  | Notes                                                                                                                                   |
| ------ | ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/organizations/:organizationId/conversations` | pet owner / clinic member / farm owner / farm member | Start (or fetch) a conversation. Idempotent — `200` existing, `201` new. `{ targetUserId? }`; required only when the org side initiates |
| GET    | `/conversations`                               | participant                                          | Paginated; a clinic member also sees the clinic's Pet Owner conversations. `?organizationId=` filter                                    |
| GET    | `/conversations/:conversationId`               | participant                                          |                                                                                                                                         |
| GET    | `/conversations/:conversationId/messages`      | participant                                          | Paginated, newest first; deleted messages show `body: null`                                                                             |
| POST   | `/conversations/:conversationId/messages`      | participant                                          | `{ body, type?: "TEXT" }`; sender is `req.auth`. Org must be ACTIVE                                                                     |
| POST   | `/conversations/:conversationId/read`          | participant with a row                               | `{ messageId }` — advances unread cursor (no-op for the dynamic clinic side)                                                            |
| DELETE | `/messages/:messageId`                         | the sender                                           | Soft delete; idempotent; row kept                                                                                                       |

**WebSocket** (`/realtime`, shares the HTTP port): connect with
`?access_token=<jwt>` (or `Authorization` header) — the same token verification
as REST, no second login. `{ "type": "subscribe", "data": { "room":
"conversation:<id>" } }` is authorized with the same relationship check as the
HTTP routes; unauthorized rooms get `{ "type": "error", ... }`. On a send the
server persists first, then emits `chat.message.created` (ids-only:
`{ conversationId, messageId, senderUserId }`) to the room after commit. Full
protocol table in `ARCHITECTURE.md` §16.4.

Domain events (ids-only, post-commit): `chat.conversation.created`,
`chat.message.created`, `chat.message.deleted`. Audit (state-changing only —
**normal messages are not audited**): `CONVERSATION_CREATED`, `MESSAGE_DELETED`.
Global permissions `chat.read` / `chat.send` / `chat.delete` are granted to **no
base role** (ADMIN override / future Communication-Supervisor).

**Not implemented** (not in the confirmed spec): media / file / image messages
(the R2 seam), message editing, per-clinic-member read receipts, typing
indicators, clinic-internal chat and office/store chat, Firebase push (the
events are the future notification seam).

### Phase 13 — consultations & inquiries (all under `/api/v1`)

Two support-thread aggregates sharing one kernel, fully separate at the data /
permission / room / event layer. Access is decided in `SupportThreadService`;
there is no per-route global-permission gate on the creator paths (authentication

- eligibility only, like Phase 4 animals). `threadId` is the path param for both.

| Method | Consultations                         | Inquiries              | Who                                                                                                                                                                |
| ------ | ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/consultations`                      | `/inquiries`           | any user / **approved vet** — creates the thread + first `USER` message; if the kind's AI flag is on, an AI reply is generated through the seam (no real provider) |
| GET    | `/consultations`                      | `/inquiries`           | the caller's own threads (paginated; `?status=`)                                                                                                                   |
| GET    | `/consultations/:threadId`            | `/inquiries/:threadId` | CREATOR or RESPONDER (else 404)                                                                                                                                    |
| GET    | `.../:threadId/messages`              | same                   | paginated, **oldest first**                                                                                                                                        |
| POST   | `.../:threadId/messages`              | same                   | CREATOR while `OPEN` & not blocked → `source: USER`; RESPONDER while `OPEN` → `SUPERVISOR`/`ADMIN`; else `409 THREAD_NOT_WRITABLE`                                 |
| POST   | `.../:threadId/close`                 | same                   | RESPONDER / admin only; idempotent; terminal                                                                                                                       |
| POST   | `.../:threadId/block` · `.../unblock` | same                   | RESPONDER / admin only; mutes the creator, thread stays `OPEN`; idempotent                                                                                         |

**Admin** (`/api/v1/admin`): `GET /admin/consultations`, `GET /admin/consultations/:threadId`
(and `/admin/inquiries…`) — requires `consultation.admin.read` / `inquiry.admin.read`
(ADMIN or the matching supervisor domain). `GET /admin/ai-settings` +
`PATCH /admin/ai-settings` (`{ consultationAiEnabled?, inquiryAiEnabled? }`) —
requires `ai.settings.manage` (**ADMIN only** in Phase 13). Supervisor
assignment for the `CONSULTATION` / `INQUIRY` domains is the **existing Phase-2**
`/admin/supervisors` API — not duplicated.

**Realtime**: `consultation:<id>` / `inquiry:<id>` rooms reuse the Phase-12
WebSocket seam; subscription is authorized with the same relationship check as
REST. Events (ids-only, post-commit): `consultation.created`,
`consultation.message.created`, `consultation.closed`,
`consultation.sender_blocked` / `…_unblocked` (and the five `inquiry.*`
equivalents), plus `ai.settings.updated`. Audit (lifecycle only — **normal
messages are not audited**): `CONSULTATION_CREATED` / `_CLOSED` /
`_SENDER_BLOCKED` / `_UNBLOCKED`, the `INQUIRY_*` equivalents, `AI_SETTING_UPDATED`.
11 global permissions added (`consultation.*` ×5, `inquiry.*` ×5,
`ai.settings.manage`), all granted to **no base role**.

**Not implemented** (Phase 14+ seams): a real AI provider (`AiResponderPort`),
AI conversation memory / streaming / per-thread config, blocking a specific
non-creator participant, consultation categories / attachments, notification
delivery.

### Phase 14 — content management (all under `/api/v1`)

`contents` (ARTICLE / BOOK / MAGAZINE) + `content_files` (metadata only) +
`categories` (M:N). Lifecycle `DRAFT → PUBLISHED → ARCHIVED` (+ soft-delete).

| Method                | Path                                                | Who                                   | Notes                                                                                                      |
| --------------------- | --------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET                   | `/content`                                          | any authed user                       | PUBLISHED, non-deleted only; `?type` `?categoryId` `?q` (full-text) + pagination                           |
| GET                   | `/content/:contentId`                               | any authed user                       | 404 for draft / archived / deleted                                                                         |
| GET                   | `/content/:contentId/files/:fileId/download`        | any authed user                       | `{ url, expiresInSeconds }` — CDN or signed GET                                                            |
| GET                   | `/content-categories`                               | any authed user                       | for filter UIs                                                                                             |
| POST                  | `/admin/content`                                    | `content.create`                      | starts DRAFT; `createdBy` derived from token                                                               |
| GET / GET             | `/admin/content` · `/admin/content/:id`             | `content.read`                        | all states; admin file DTOs include `storageKey`; `?status` `?includeDeleted`                              |
| PATCH                 | `/admin/content/:id`                                | `content.update`                      | title / description / body / author / `categoryIds`; never status                                          |
| DELETE / POST         | `/admin/content/:id` · `/admin/content/:id/restore` | `content.delete` (**ADMIN-only**)     | soft; idempotent                                                                                           |
| POST                  | `/admin/content/:id/publish` · `/archive`           | `content.publish` / `content.archive` | idempotent                                                                                                 |
| POST                  | `/admin/content/:id/files/upload-url`               | `content.upload`                      | validates kind/MIME/size → `{ storageKey, uploadUrl, method, headers, expiresInSeconds }`; **no DB write** |
| POST                  | `/admin/content/:id/files`                          | `content.upload`                      | register after upload; HEAD + real size/type check; MAIN/COVER replace                                     |
| DELETE / GET          | `/admin/content/:id/files/:fileId` · `…/download`   | `content.upload` / `content.read`     | soft-delete + best-effort storage delete; admin download works for any state                               |
| GET/POST/PATCH/DELETE | `/admin/content-categories…`                        | `content.category.manage`             | slug immutable once set; soft-delete                                                                       |

Global permissions added (**no base role**): `content.read`, `content.create`,
`content.update`, `content.delete`, `content.publish`, `content.archive`,
`content.upload`, `content.category.manage`. The **CONTENT** system-supervisor
domain grants all of these **except `content.delete`**.

Events (ids + safe metadata, post-commit): `content.created` / `.updated` /
`.published` / `.archived` / `.deleted` / `.restored`, `content.file.uploaded` /
`.replaced` / `.deleted`, `content.category.created` / `.updated` / `.deleted`.
Audit: `CONTENT_CREATED` / `_UPDATED` / `_PUBLISHED` / `_ARCHIVED` / `_DELETED` /
`_RESTORED`, `CONTENT_FILE_UPLOADED` / `_REPLACED` / `_DELETED`,
`CONTENT_CATEGORY_CREATED` / `_UPDATED` / `_DELETED` — **never** storage keys,
URLs, credentials or the article body. Realtime: `content:feed` room (Admin /
Content Supervisor). See `ARCHITECTURE.md` §18.

**Not implemented**: real R2 end-to-end verification (tests mock storage — needs
`R2_*` creds), multipart proxy upload, content versioning, HTML sanitisation,
virus scan, image thumbnailing, an orphan-object sweep job, notification
consumers.

### Phase 15 — notifications & Firebase FCM (all under `/api/v1`)

In-app notifications + FCM device tokens + push. Domain events → EventBus →
`NotificationEventHandler` → `NotificationPolicy` (recipient resolution) →
`NotificationService` (in-app row + realtime + FCM). **No domain module imports
`firebase-admin`** — the Phase-1 push abstraction is reused. Every
`/notifications*` route is authentication + ownership only.

| Method      | Path                                  | Notes                                                                                                  |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET         | `/notifications`                      | own inbox, newest-first, paginated; `?read=true\|false` `?type=`                                       |
| GET         | `/notifications/unread-count`         | `{ count }` — indexed, no list load                                                                    |
| GET         | `/notifications/:notificationId`      | own only (404 otherwise)                                                                               |
| POST        | `/notifications/:notificationId/read` | own; idempotent                                                                                        |
| POST        | `/notifications/read-all`             | own; `{ updated }`                                                                                     |
| GET / PATCH | `/notifications/preferences`          | `{ pushEnabled }` — gates FCM only                                                                     |
| POST        | `/notifications/devices`              | register / refresh an FCM token (upsert by token; ownership from `req.auth`)                           |
| GET         | `/notifications/devices`              | own devices — returns `tokenSuffix` only, never the raw token                                          |
| DELETE      | `/notifications/devices/:deviceId`    | own only (404 otherwise)                                                                               |
| POST        | `/admin/notifications`                | `notification.admin.send` — `target: {kind: USER\|ROLE\|ALL, …}`; capped at 5000; FCM fan-out detached |

Notification types are a central catalogue (`NOTIFICATION_TYPES`): organization
approval / rejection / suspension / activation, member added / removed,
supervisor assigned, `CHAT_MESSAGE_RECEIVED`, `CONSULTATION_*` / `INQUIRY_*`
(created / message / closed), plus `ADMIN_ANNOUNCEMENT`. `content.published` is
**not** auto-broadcast (no spec requires it). One global permission added
(`notification.admin.send`, no base role). Realtime events (ids-only):
`notification.created` / `notification.read` on `user:<id>`. Audit
(non-message actions only): `DEVICE_TOKEN_REGISTERED` / `_REVOKED`,
`ADMIN_NOTIFICATION_SENT`, `NOTIFICATION_PREFERENCE_UPDATED` — **never** the FCM
token, Firebase creds, or a broadcast body. Config: reuses the existing
`FIREBASE_*` env (fail-fast when set incompletely; a logging no-op provider
otherwise). See `ARCHITECTURE.md` §19.

**Not implemented**: real FCM end-to-end (tests inject `FakePushProvider` —
needs valid `FIREBASE_*`), durable retry / a broadcast queue, per-type / quiet-
hours preferences, `content.published` fan-out, notification retention/cleanup.

### Phase 16 — production hardening (no new endpoints)

Audit + hardening pass over every module (auth, RBAC, org RBAC, animals,
veterinary care, farms, store, chat, consultations/inquiries, content,
notifications, realtime, storage, admin, audit). Changes: WebSocket
connection cap (`REALTIME_MAX_CONNECTIONS` → HTTP 503), DB `statement_timeout`
(`DB_STATEMENT_TIMEOUT_MS`), `DB_SSL_REJECT_UNAUTHORIZED`, container
`HEALTHCHECK` on `GET /health`, and [`docs/OPERATIONS.md`](./docs/OPERATIONS.md).
OpenAPI bumped to `0.14.0` (path count unchanged at 125). Full detail in the
Phase 16 report and `ARCHITECTURE.md` §20.

**Deferred to operations / future**: multi-node realtime fan-out (Redis
gateway), durable event queue with retry/DLQ, R2 orphan-object sweep,
`JWT_ACCESS_SECRET` key-rotation window, Prometheus metrics / OpenTelemetry
tracing, application-managed backups.

## Infrastructure (foundations only — wired in later phases)

| Concern      | Abstraction                                            | Production impl                   | Fallback (no creds)       |
| ------------ | ------------------------------------------------------ | --------------------------------- | ------------------------- |
| Real-time    | `RealtimePublisher` / `RealtimeGateway`                | `WsRealtimeGateway` (`ws`)        | disabled / anonymous dev  |
| Push         | `PushNotificationProvider` / `PushNotificationService` | `FirebasePushProvider` (FCM)      | `NoopPushProvider` (logs) |
| Object store | `ObjectStorage`                                        | `R2ObjectStorage` (Cloudflare R2) | `InMemoryObjectStorage`   |
| Events       | `EventBus`                                             | `InMemoryEventBus`                | —                         |

- **WebSocket endpoint**: `ws(s)://<host>/realtime` — shares the HTTP port.
  Connections are authenticated (`ConnectionAuthenticator`) and `subscribe`
  requests are authorized (`RealtimeAuthorizer`) with the same org-scoping as
  REST. Until Phase 2 the default authenticator **denies all** connections; set
  `REALTIME_ALLOW_ANONYMOUS=true` (non-production) for local testing.
- Business modules never import `ws` / `firebase-admin` / `@aws-sdk` — they get
  a narrow interface from `createInfrastructure()` and publish domain events on
  the `EventBus`; the realtime/push bridges fan them out.
- All vendor credentials come from env only (`FIREBASE_*`, `R2_*`); missing
  credentials fall back to the safe local implementation.

## Response format

Success:

```json
{ "data": { "...": "..." }, "meta": { "...": "..." } }
```

Error:

```json
{ "error": { "code": "NOT_FOUND", "message": "…", "details": [], "requestId": "…" } }
```

## Configuration

All configuration comes from environment variables, validated at startup
(`src/config/index.ts`). See [`.env.example`](./.env.example). Missing or invalid
values fail fast with a descriptive error.

Production hardening knobs (Phase 16): `DB_STATEMENT_TIMEOUT_MS` (default
`30000`, `0` disables) caps every query; `DB_SSL_REJECT_UNAUTHORIZED` (default
`false`) toggles DB certificate-chain verification when `DB_SSL=true`;
`REALTIME_MAX_CONNECTIONS` (default `10000`, `0` disables) caps concurrent
WebSocket connections per node. Operational procedures (backups, restore,
migration rollback, disaster recovery, required prod config) live in
[`docs/OPERATIONS.md`](./docs/OPERATIONS.md).

## Authentication & tokens

- **Access token**: stateless HS256 JWT, 15 min default (`JWT_ACCESS_TTL`).
  Carries `sub` (user id) and `sid` (refresh session id). Sent as
  `Authorization: Bearer <jwt>`.
- **Refresh token**: opaque 256-bit random string. Only a SHA-256 hash is stored
  (`refresh_sessions.token_hash`). One row per session/device — a user can hold
  many. **Rotated on every `/auth/refresh`**: the presented token is revoked and
  a new pair returned. Replaying a rotated token revokes every session for that
  user and writes a `REFRESH_TOKEN_REUSE_DETECTED` audit entry.
- **Logout** revokes the current session; **logout-all**, **suspend** and
  **deactivate** revoke all sessions. `authenticate` reloads the user every
  request, so a suspended/deactivated account is rejected immediately (not only
  when the access token expires).

## Project layout

```
src/
  config/  shared/{errors,http,middleware,logger,events,validation,time,database}/
  database/{migrations,seeds}/  infra/{realtime,push,storage}/
  modules/{auth,users,rbac,authorization,veterinarians,supervisors,audit,health}/
  modules/organizations/{domain,infrastructure,application,presentation}/
  modules/animals/{domain,infrastructure,application,presentation}/
  modules/veterinary-care/{domain,infrastructure,application,presentation}/
  modules/farms/{domain,infrastructure,application,presentation}/
  modules/veterinary-store/{domain,infrastructure,application,presentation}/
  modules/chat/{domain,infrastructure,application,presentation,realtime}/
  modules/consultations/{domain,infrastructure,application,presentation,realtime}/  # + inquiries (shared kernel)
  modules/content/{domain,infrastructure,application,presentation,realtime}/
  modules/notifications/{domain,infrastructure,application,presentation,realtime}/
  container.ts  routes/  openapi/  app.ts  server.ts
test/  unit/  integration/  helpers/
docs/  OPERATIONS.md  (+ 01–05 product spec)
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the layering conventions, the
authorization model and future-compatibility notes.
