# Daily database backup → Google Drive

Every day at **14:00 Egypt time** (`Africa/Cairo`, DST handled by systemd) the
VPS dumps PostgreSQL, uploads the dump to Google Drive with rclone and deletes
Drive dumps older than **30 days**. Files:

| File                                           | Role                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `deploy/scripts/backup.sh`                     | `pg_dump` → `backups/bytari-<UTC>-<label>.dump` (existing; also used by `deploy.sh`) |
| `deploy/scripts/backup-offsite.sh`             | dump → verify → upload → 30-day remote retention → email on failure                  |
| `deploy/systemd/bytari-backup.{service,timer}` | the schedule                                                                         |

What is backed up: **the database only.** Not included: R2 images/files and
`/opt/bytari/.env` (keep `.env` in your password manager).

## 1. One-time setup (on the VPS)

rclone must be configured **as the `deploy` user** (the service runs as
`deploy` and reads `~deploy/.config/rclone/rclone.conf`).

```sh
# as root (or with sudo)
curl https://rclone.org/install.sh | bash          # skip if rclone is installed

# as deploy
su - deploy
rclone config              # remote name: gdrive, storage: drive (skip if already done)
rclone lsd gdrive:         # must list your Drive folders without errors
```

If you configured rclone as another user (e.g. root), copy the config:
`install -D -o deploy -g deploy -m 600 /root/.config/rclone/rclone.conf /home/deploy/.config/rclone/rclone.conf`.

Optional settings — `/opt/bytari/.backup.env` (`chmod 600`, owned by deploy):

```sh
BACKUP_REMOTE=gdrive:bytari-backups   # rclone destination (default shown)
BACKUP_RETENTION_DAYS=30              # Drive retention (default 30)
BACKUP_KEEP=7                         # dumps kept on the VPS disk (default 7)
ALERT_EMAIL=you@example.com           # failure alerts, sent with the EMAIL_* SMTP account in .env
```

Copy the new files to the VPS (from your machine, in `server/`):

```sh
scp -r deploy deploy@VPS_IP:/opt/bytari/
```

Install the timer (as root / sudo on the VPS):

```sh
chmod +x /opt/bytari/deploy/scripts/*.sh
cp /opt/bytari/deploy/systemd/bytari-backup.service /opt/bytari/deploy/systemd/bytari-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bytari-backup.timer
systemctl list-timers bytari-backup.timer          # shows the next run
```

Remove the old cron line if you added one (`crontab -e` as deploy).

## 2. Test it now

```sh
sudo systemctl start bytari-backup.service         # runs a backup immediately
journalctl -u bytari-backup.service -n 50 --no-pager
sudo -u deploy rclone ls gdrive:bytari-backups/db  # the new dump is listed
```

## 3. Day to day

- Logs: `journalctl -u bytari-backup.service --since "7 days ago"`
- Last result: `systemctl status bytari-backup.service`
- Change the time: edit `OnCalendar=` in `/etc/systemd/system/bytari-backup.timer`,
  then `systemctl daemon-reload`.
- Deletes on Drive are permanent (`--drive-use-trash=false`) so old dumps do
  not keep using the 15 GB quota from the trash.

## 4. Restore

```sh
cd /opt/bytari
sudo -u deploy rclone ls gdrive:bytari-backups/db                 # pick a dump
sudo -u deploy rclone copy gdrive:bytari-backups/db/bytari-<UTC>-daily.dump backups/
docker compose -f docker-compose.production.yml stop api
docker compose -f docker-compose.production.yml exec -T db sh -c \
  'pg_restore --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/bytari-<UTC>-daily.dump
docker compose -f docker-compose.production.yml start api
curl -fsS https://api.baytari.com/health/ready
```

Rehearse a restore into a scratch database every few months.
