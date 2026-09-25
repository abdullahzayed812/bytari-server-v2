#!/usr/bin/env bash
# First-time TLS bootstrap for baytari.com / www.baytari.com / api.baytari.com.
#
#   init-letsencrypt.sh dummy            1) self-signed placeholder so nginx can start
#   (run deploy/scripts/deploy.sh with SMOKE_INSECURE=1)
#   init-letsencrypt.sh issue [--staging] 2) real Let's Encrypt cert via HTTP-01 webroot, reload nginx
#
# DNS A records for all three names must already point at this VPS and
# ports 80/443 must be open before `issue`. Renewal afterwards is automatic
# (certbot service + 6-hourly nginx reload in docker-compose.production.yml).
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f docker-compose.production.yml)
DOMAINS=(baytari.com www.baytari.com api.baytari.com)
PRIMARY="${DOMAINS[0]}"
LIVE="/etc/letsencrypt/live/$PRIMARY"

email="$(grep -E '^LETSENCRYPT_EMAIL=' .env | tail -n1 | cut -d= -f2- | tr -d '"')"

case "${1:-}" in
  dummy)
    echo "init-letsencrypt: creating a 1-day self-signed placeholder for $PRIMARY"
    "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh certbot -c "
      set -e
      if [ -f '$LIVE/fullchain.pem' ]; then echo 'certificate already present — skipping'; exit 0; fi
      mkdir -p '$LIVE'
      openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
        -keyout '$LIVE/privkey.pem' -out '$LIVE/fullchain.pem' -subj '/CN=$PRIMARY' >/dev/null 2>&1
      echo 'placeholder written'
    "
    ;;
  issue)
    [[ -n "$email" ]] || { echo "init-letsencrypt: set LETSENCRYPT_EMAIL in .env" >&2; exit 1; }
    staging=()
    [[ "${2:-}" == "--staging" ]] && staging=(--staging)
    "${COMPOSE[@]}" ps --status running --services | grep -qx nginx \
      || { echo "init-letsencrypt: nginx is not running — deploy first" >&2; exit 1; }

    domain_args=()
    for d in "${DOMAINS[@]}"; do domain_args+=(-d "$d"); done

    echo "init-letsencrypt: removing the placeholder and requesting a real certificate"
    "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh certbot -c "
      rm -rf '/etc/letsencrypt/live/$PRIMARY' '/etc/letsencrypt/archive/$PRIMARY' \
             '/etc/letsencrypt/renewal/$PRIMARY.conf'
    "
    if ! "${COMPOSE[@]}" run --rm --no-deps --entrypoint certbot certbot certonly \
      --webroot -w /var/www/certbot "${staging[@]}" \
      --email "$email" --agree-tos --no-eff-email --rsa-key-size 4096 \
      --cert-name "$PRIMARY" "${domain_args[@]}" --non-interactive; then
      echo "init-letsencrypt: issuance FAILED — restoring the placeholder so nginx can still restart" >&2
      "$0" dummy
      exit 1
    fi

    "${COMPOSE[@]}" exec -T nginx nginx -s reload
    echo "init-letsencrypt: certificate installed and nginx reloaded"
    ;;
  *)
    echo "usage: $0 dummy | issue [--staging]" >&2
    exit 2
    ;;
esac
