#!/usr/bin/env bash
# Production deploy for the single-VPS Docker Compose stack (/opt/bytari).
#
#   deploy/scripts/deploy.sh [--api-tag TAG] [--web-tag TAG] [--skip-backup] [--skip-migrations] [--no-pull]
#
# Omitted tags keep what is currently deployed (deploy/state/current.env,
# falling back to API_TAG / WEB_TAG in .env). Steps — any failure exits non-zero:
#
#   1. validate .env + compose config
#   2. pull the target images
#   3. ensure the database is up, then back it up (pg_dump)
#   4. run migrations + idempotent seeds with the NEW api image
#   5. start / replace containers and wait for their healthchecks
#   6. smoke-test through the real edge (TLS, vhosts, API readiness, web)
#   7. record the release; on failure after step 5 roll back the images
#
# Migrations are forward-only here: an image rollback does NOT undo a
# migration (all migrations are additive — see docs/deployment.md §Rollback).
# Replacing the api container causes a brief (seconds) window of 502s for
# in-flight requests; this is a single-node deployment, not zero-downtime.
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f docker-compose.production.yml)
STATE_DIR=deploy/state
mkdir -p "$STATE_DIR"

# One deploy at a time — the server and client pipelines both deploy here.
exec 9>"$STATE_DIR/.deploy.lock"
if ! flock -w 600 9; then
  echo "[deploy] another deploy has held the lock for 10 minutes — aborting" >&2
  exit 1
fi

log() { printf '\n[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { printf '\n[deploy] FAILED: %s\n' "$*" >&2; exit 1; }

# Value of KEY in an env file; empty (not an error) if the file or key is absent.
env_value() {
  [[ -f "$2" ]] || return 0
  { grep -E "^$1=" "$2" || true; } | tail -n1 | cut -d= -f2- | tr -d '"'
}

# --- args ---------------------------------------------------------------------
API_TAG_ARG="" WEB_TAG_ARG="" SKIP_BACKUP=0 SKIP_MIGRATIONS=0 NO_PULL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-tag) API_TAG_ARG="$2"; shift 2 ;;
    --web-tag) WEB_TAG_ARG="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    # Used by rollback.sh: an OLDER image must not run `migrate latest` — knex
    # rejects a database that already has migrations the image doesn't know.
    --skip-migrations) SKIP_MIGRATIONS=1; shift ;;
    # Images already present locally (e.g. `docker load`); never pulls.
    --no-pull) NO_PULL=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

CUR_API="$(env_value API_TAG "$STATE_DIR/current.env")"
CUR_WEB="$(env_value WEB_TAG "$STATE_DIR/current.env")"
CUR_API="${CUR_API:-$(env_value API_TAG .env)}"
CUR_WEB="${CUR_WEB:-$(env_value WEB_TAG .env)}"
export API_TAG="${API_TAG_ARG:-${CUR_API:-latest}}"
export WEB_TAG="${WEB_TAG_ARG:-${CUR_WEB:-latest}}"
log "target  api=$API_TAG  web=$WEB_TAG   (current api=${CUR_API:-none} web=${CUR_WEB:-none})"

# --- 1. validate ----------------------------------------------------------------
log "1/7 validating environment"
deploy/scripts/check-env.sh .env
"${COMPOSE[@]}" config --quiet || die "docker-compose.production.yml is invalid"

# --- 2. pull --------------------------------------------------------------------
if (( NO_PULL )); then
  log "2/7 pull skipped (--no-pull)"
else
  log "2/7 pulling images"
  "${COMPOSE[@]}" pull --quiet || die "image pull failed"
fi

# --- 3. database + backup ---------------------------------------------------------
log "3/7 starting database"
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 db || die "database did not become healthy"
if (( SKIP_BACKUP )); then
  log "backup skipped (--skip-backup)"
else
  deploy/scripts/backup.sh pre-deploy || die "pre-deploy backup failed — not migrating"
fi

# --- 4. migrations (new image, explicit) ---------------------------------------------
if (( SKIP_MIGRATIONS )); then
  log "4/7 migrations skipped (--skip-migrations)"
else
  log "4/7 running migrations + catalogue seeds"
  "${COMPOSE[@]}" run --rm --no-deps api node dist/database/migrate.js latest \
    || die "migration failed — the previous release is still serving; restore from backups/ if needed"
  "${COMPOSE[@]}" run --rm --no-deps api node dist/database/migrate.js seed \
    || die "catalogue seed failed"
fi

# --- 5. start ----------------------------------------------------------------------
rollback() {
  if [[ -n "$CUR_API" && -n "$CUR_WEB" && ( "$CUR_API" != "$API_TAG" || "$CUR_WEB" != "$WEB_TAG" ) ]]; then
    printf '\n[deploy] rolling back images to api=%s web=%s\n' "$CUR_API" "$CUR_WEB" >&2
    API_TAG="$CUR_API" WEB_TAG="$CUR_WEB" "${COMPOSE[@]}" up -d --wait --wait-timeout 180 api web nginx \
      || printf '[deploy] ROLLBACK ALSO FAILED — intervene manually (docs/deployment.md)\n' >&2
  else
    printf '\n[deploy] no previous release recorded — nothing to roll back to\n' >&2
  fi
}

log "5/7 starting services"
if ! "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180; then
  "${COMPOSE[@]}" ps >&2 || true
  "${COMPOSE[@]}" logs --tail 80 api web nginx >&2 || true
  rollback
  die "services did not become healthy"
fi

# --- 6. smoke test through the edge ---------------------------------------------------
log "6/7 smoke testing https://baytari.com and https://api.baytari.com"
curl_opts=(-fsS -o /dev/null --max-time 10 --retry 5 --retry-delay 3 --retry-all-errors)
# Before the real certificate exists (first deploy) the placeholder is self-signed.
[[ "${SMOKE_INSECURE:-0}" == "1" ]] && curl_opts+=(-k)
https_port="$(env_value EDGE_HTTPS_PORT .env)"; https_port="${https_port:-443}"
resolve=(--resolve "baytari.com:$https_port:127.0.0.1" --resolve "api.baytari.com:$https_port:127.0.0.1")
smoke() {
  local url="$1"
  if curl "${curl_opts[@]}" "${resolve[@]}" "$url"; then
    echo "  ok   $url"
  else
    echo "  FAIL $url" >&2
    return 1
  fi
}
ok=1
smoke "https://api.baytari.com:$https_port/health" || ok=0
smoke "https://api.baytari.com:$https_port/health/ready" || ok=0
smoke "https://baytari.com:$https_port/" || ok=0
smoke "https://baytari.com:$https_port/pets/smoke-test-deep-link" || ok=0
if (( ! ok )); then
  rollback
  die "smoke test failed"
fi

# --- 7. record --------------------------------------------------------------------
[[ -f "$STATE_DIR/current.env" ]] && cp "$STATE_DIR/current.env" "$STATE_DIR/previous.env"
printf 'API_TAG=%s\nWEB_TAG=%s\nDEPLOYED_AT=%s\n' "$API_TAG" "$WEB_TAG" "$(date -u +%FT%TZ)" \
  > "$STATE_DIR/current.env"
log "7/7 deployed api=$API_TAG web=$WEB_TAG"
"${COMPOSE[@]}" ps
