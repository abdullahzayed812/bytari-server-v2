#!/usr/bin/env bash
# Validate /opt/bytari/.env before a deploy. Prints variable NAMES only —
# never values. Exit 1 on any problem.
set -euo pipefail

ENV_FILE="${1:-.env}"
[[ -f "$ENV_FILE" ]] || { echo "check-env: $ENV_FILE not found" >&2; exit 1; }

errors=0
fail() { echo "check-env: $*" >&2; errors=$((errors + 1)); }

# Read KEY=VALUE lines without `source` (values may contain $, spaces, \n).
get() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

perm="$(stat -c '%a' "$ENV_FILE")"
[[ "$perm" == "600" || "$perm" == "400" ]] || fail "$ENV_FILE permissions are $perm — run: chmod 600 $ENV_FILE"

for key in DB_NAME DB_USER DB_PASSWORD JWT_ACCESS_SECRET CORS_ORIGINS \
           R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  v="$(get "$key")"
  [[ -n "$v" ]] || fail "$key is empty"
done

# Any placeholder left anywhere (FIREBASE_PRIVATE_KEY, EMAIL_PASS, …).
while IFS= read -r key; do
  fail "$key still has the placeholder value"
done < <(grep -oE '^[A-Z0-9_]+="?CHANGE_ME"?$' "$ENV_FILE" | cut -d= -f1)

# An empty `KEY=` reaches the app as "" and fails its format validation —
# optional settings must be commented out instead.
while IFS= read -r key; do
  fail "$key is set to an empty value — comment the line out or give it a value"
done < <(grep -oE '^[A-Z0-9_]+=$' "$ENV_FILE" | tr -d '=')

jwt="$(get JWT_ACCESS_SECRET)"
(( ${#jwt} >= 32 )) || fail "JWT_ACCESS_SECRET must be at least 32 characters"

cors="$(get CORS_ORIGINS)"
[[ "$cors" != *"*"* ]] || fail "CORS_ORIGINS must not contain '*' in production"
[[ "$cors" != *"localhost"* && "$cors" != *"http://"* ]] || fail "CORS_ORIGINS must only list https:// public origins"

if [[ -z "$(get FIREBASE_SERVICE_ACCOUNT_JSON)" && -z "$(get FIREBASE_PROJECT_ID)" ]]; then
  echo "check-env: warning — no Firebase credentials: push notifications disabled (in-app still works)" >&2
fi
if [[ -z "$(get EMAIL_USER)" ]]; then
  echo "check-env: warning — EMAIL_USER empty: verification emails will not be sent" >&2
fi

if (( errors > 0 )); then
  echo "check-env: $errors problem(s) found" >&2
  exit 1
fi
echo "check-env: OK"
