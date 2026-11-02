#!/usr/bin/env bash
# Daily database backup → Google Drive (rclone), with 30-day retention.
#
#   deploy/scripts/backup-offsite.sh
#
# Run by the `bytari-backup.timer` systemd unit (deploy/systemd/), as the
# `deploy` user, from /opt/bytari. Steps:
#   1. pg_dump via deploy/scripts/backup.sh  → backups/bytari-<UTC>-daily.dump
#   2. verify the dump is a readable pg_dump archive (pg_restore --list)
#   3. upload it to $BACKUP_REMOTE/db/ (rclone verifies the checksum)
#   4. delete remote dumps older than $BACKUP_RETENTION_DAYS (permanently —
#      not to the Drive trash, which would still use the quota)
# Any failure exits non-zero (systemd marks the unit failed) and, when
# ALERT_EMAIL is set, emails an alert through the app's SMTP account (.env).
#
# Settings (optional file /opt/bytari/.backup.env, or the environment):
#   BACKUP_REMOTE           rclone destination        (default gdrive:bytari-backups)
#   BACKUP_RETENTION_DAYS   remote retention in days  (default 30)
#   BACKUP_KEEP             dumps kept on the VPS     (default 7)
#   ALERT_EMAIL             failure alerts recipient  (default: none)
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -f .backup.env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.backup.env; set +a
fi
REMOTE="${BACKUP_REMOTE:-gdrive:bytari-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
export BACKUP_KEEP="${BACKUP_KEEP:-7}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
COMPOSE=(docker compose -f docker-compose.production.yml)

log() { echo "[$(date -u +%FT%TZ)] backup-offsite: $*"; }

# Value of KEY from /opt/bytari/.env (no `source`: values may hold shell syntax).
env_value() {
  local line
  line="$(grep -E "^$1=" .env 2>/dev/null | tail -n 1)" || true
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

send_alert() {
  local subject="$1" body="$2"
  [[ -n "$ALERT_EMAIL" ]] || return 0
  local host port secure user pass from url tmp
  host="$(env_value EMAIL_HOST)"; port="$(env_value EMAIL_PORT)"
  secure="$(env_value EMAIL_SECURE)"; user="$(env_value EMAIL_USER)"
  pass="$(env_value EMAIL_PASS)"; from="$(env_value EMAIL_FROM)"
  from="${from:-$user}"
  if [[ -z "$host" || -z "$user" || -z "$pass" ]]; then
    log "alert not sent: EMAIL_HOST / EMAIL_USER / EMAIL_PASS missing in .env"
    return 0
  fi
  if [[ "${secure:-true}" == "false" ]]; then
    url="smtp://${host}:${port:-587}"
  else
    url="smtps://${host}:${port:-465}"
  fi
  # Credentials go through a 600 config file, never argv (visible in `ps`).
  tmp="$(mktemp -d)"; chmod 700 "$tmp"
  printf 'user = "%s:%s"\n' "$user" "$pass" > "$tmp/curl.conf"
  {
    printf 'From: Bytari Backups <%s>\r\nTo: <%s>\r\nSubject: %s\r\n' "$from" "$ALERT_EMAIL" "$subject"
    printf 'Content-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n' "$body"
  } > "$tmp/mail.txt"
  if ! curl -sS --ssl-reqd --url "$url" --mail-from "$from" --mail-rcpt "$ALERT_EMAIL" \
    -K "$tmp/curl.conf" -T "$tmp/mail.txt" --max-time 60; then
    log "alert email could not be sent"
  fi
  rm -rf "$tmp"
}

STEP="starting"
on_error() {
  local code=$?
  log "FAILED at step: $STEP (exit $code)"
  send_alert "[Bytari] Daily DB backup FAILED ($(hostname))" \
    "The daily database backup failed at step: ${STEP} (exit ${code}).
Time (UTC): $(date -u +%FT%TZ)
Check: journalctl -u bytari-backup.service -n 100"
  exit "$code"
}
trap on_error ERR

# Never let two runs overlap (e.g. a manual run during the timer's run).
mkdir -p backups
exec 9> backups/.offsite.lock
flock -n 9 || { log "another backup run is in progress — skipping"; exit 0; }

STEP="rclone remote check"
command -v rclone >/dev/null
rclone lsf "${REMOTE%%:*}:" --max-depth 1 >/dev/null

STEP="pg_dump"
deploy/scripts/backup.sh daily
DUMP="$(ls -1t backups/bytari-*-daily.dump | sed -n 1p)"
[[ -s "$DUMP" ]]

STEP="verify dump"
"${COMPOSE[@]}" exec -T db pg_restore --list < "$DUMP" > /dev/null

STEP="upload to $REMOTE"
rclone copy "$DUMP" "$REMOTE/db/" --retries 5 --low-level-retries 10
rclone lsf "$REMOTE/db/" --include "$(basename "$DUMP")" | grep -qx "$(basename "$DUMP")"

STEP="remote retention (${RETENTION_DAYS}d)"
rclone delete "$REMOTE/db/" --include 'bytari-*.dump' --min-age "${RETENTION_DAYS}d" \
  --drive-use-trash=false

log "OK — uploaded $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1)) to $REMOTE/db/"
