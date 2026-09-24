#!/usr/bin/env bash
# PostgreSQL logical backup of the production database.
#
#   deploy/scripts/backup.sh [label]      → backups/bytari-<UTC timestamp>[-label].dump
#
# Custom-format pg_dump (restore with pg_restore, see docs/deployment.md).
# Keeps the newest $BACKUP_KEEP dumps (default 14). Run from /opt/bytari.
# Called automatically by deploy.sh before migrations; schedule it with cron
# for regular backups (docs/deployment.md §Backups).
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f docker-compose.production.yml)
KEEP="${BACKUP_KEEP:-14}"
LABEL="${1:-}"
mkdir -p backups
chmod 700 backups

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="backups/bytari-${ts}${LABEL:+-$LABEL}.dump"

if ! "${COMPOSE[@]}" ps --status running --services | grep -qx db; then
  echo "backup: db service is not running — nothing to back up" >&2
  exit 2
fi

# Credentials come from the container's own environment — nothing on argv.
# shellcheck disable=SC2016  # expanded inside the container, on purpose
"${COMPOSE[@]}" exec -T db sh -c \
  'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$out.partial"
mv "$out.partial" "$out"
chmod 600 "$out"
echo "backup: wrote $out ($(du -h "$out" | cut -f1))"

# Retention.
ls -1t backups/bytari-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
