# Development persona seed

`npm run db:seed:dev` (`src/database/dev-seed/run.ts`) creates a fixed set of
development accounts so the mobile app's dev quick-login chips (and manual
testing) have something to log into. It drives the real application services
(`register`, `apply`/`approve` veterinarian, `create` organization, `addMember`,
…), so every seeded record obeys the same business rules, audit logging and
events as a real request — nothing bypasses authentication.

Run migrations + the RBAC seed first, then this:

```
npm run db:migrate
npm run db:seed       # roles / permissions
npm run db:seed:dev   # personas, organizations, sample data
```

Idempotent — safe to re-run any time (find-or-create, then converge state).

Guarded by `devSeedGate` in `run.ts`: runs automatically when
`NODE_ENV=development`, opt-in elsewhere via `ENABLE_DEV_SEEDS=true`, and is
**never** allowed when `NODE_ENV=production`.

## Accounts

Shared password for every persona: `DevPassword123!`

| Email                         | Notes                                          |
| ------------------------------ | ----------------------------------------------- |
| admin@example.test             | ADMIN role                                      |
| moderator@example.test         | MODERATOR role                                  |
| owner@example.test             | Pet owner; owns Max/Luna/Kiwi                   |
| vet@example.test               | Veterinarian, APPROVED                          |
| vet.pending@example.test       | Veterinarian, PENDING                           |
| vet.rejected@example.test      | Veterinarian, REJECTED                          |
| clinic.owner@example.test      | Owns "Bytari Dev Clinic"                        |
| farm.owner@example.test        | Owns "Bytari Dev Farm" (+ a poultry flock)      |
| office.owner@example.test      | Owns "Bytari Dev Veterinary Office"             |
| store.owner@example.test       | Owns "Bytari Dev Veterinary Store" (+ products) |
| org.vet@example.test           | VETERINARIAN member of the dev clinic           |
| supervisor@example.test        | Read-only SUPERVISOR of the dev clinic          |
| staff@example.test             | STAFF member of the dev clinic                  |
| multi.org@example.test         | VETERINARIAN at the clinic, STAFF at the farm   |

The mobile app's `DevAccountPicker` (dev builds only) lists these same
accounts — see `mobile/src/features/auth/components/DevAccountPicker.tsx`.
