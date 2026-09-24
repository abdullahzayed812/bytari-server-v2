#!/usr/bin/env bash
# Roll the api + web images back to the previous successful release
# (deploy/state/previous.env), or to explicit tags:
#
#   deploy/scripts/rollback.sh
#   deploy/scripts/rollback.sh --api-tag <tag> --web-tag <tag>
#   deploy/scripts/rollback.sh --no-pull      (previous images still cached locally)
#
# Images only — database migrations are NOT reverted (they are additive and
# backward-compatible by policy; for a destructive problem restore a dump,
# see docs/deployment.md §Rollback). No backup / migration step is run.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Value of KEY in an env file; empty (not an error) if the file or key is absent.
env_value() {
  [[ -f "$2" ]] || return 0
  { grep -E "^$1=" "$2" || true; } | tail -n1 | cut -d= -f2- | tr -d '"'
}

API="" WEB="" EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-tag) API="$2"; shift 2 ;;
    --web-tag) WEB="$2"; shift 2 ;;
    --no-pull) EXTRA+=(--no-pull); shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
API="${API:-$(env_value API_TAG deploy/state/previous.env)}"
WEB="${WEB:-$(env_value WEB_TAG deploy/state/previous.env)}"
[[ -n "$API" && -n "$WEB" ]] || { echo "rollback: no previous release recorded — pass --api-tag/--web-tag" >&2; exit 1; }

echo "rollback: → api=$API web=$WEB"
exec deploy/scripts/deploy.sh --api-tag "$API" --web-tag "$WEB" --skip-backup --skip-migrations "${EXTRA[@]}"
