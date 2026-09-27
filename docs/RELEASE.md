# Publishing a new version — release checklist

A short, step-by-step checklist for shipping changes to production
(`https://api.baytari.com` + `https://baytari.com`). The full infrastructure
reference (VPS setup, secrets, TLS, backups) is in [`DEPLOYMENT.md`](./DEPLOYMENT.md);
this file is only "what do I run when I want to publish again".

## How publishing works (in one minute)

- **Pushing to `main` never deploys.** It only runs CI.
- **A version tag deploys** (`vX.Y.Z` pushed to GitHub), in each repo separately:
  - server repo → builds the API image → runs `deploy.sh --api-tag vX.Y.Z` on the VPS
  - mobile repo → builds the Expo Web image → runs `deploy.sh --web-tag vX.Y.Z`
- **The deploy job depends on CI** (`needs: ci`). If CI fails on the tagged
  commit, nothing is built or deployed — production keeps running the previous
  version. A red CI can never break production; it just blocks the release.
- The tag deploys the **web** app only. Android / iOS apps are separate (see §6).

## 1. Before tagging — make CI green on `main`

Run locally what CI runs (it only checks Prettier on the files you changed):

**server/**

```bash
npm run typecheck
npm run lint                         # warnings are OK, errors are not
npx prettier --write <changed files> # or: npm run format
npm test                             # unit + integration (integration is slow, >10 min)
npm run build
```

**mobile/**

```bash
npm run typecheck
npm run lint
npx prettier --write <changed files>
npx jest
```

Changed files since the last release (for Prettier):

```bash
git diff --name-only --diff-filter=ACMR <last-tag> -- '*.ts' '*.tsx' '*.js' '*.json' | grep -v package-lock.json
```

Commit, push to `main`, and wait until **CI is green in both repos** on GitHub
(Actions tab).

> Commit messages with double quotes `"` inside break `git commit -m "..."`.
> Use a heredoc instead:
>
> ```bash
> git commit -F - <<'EOF'
> feat: short summary
>
> - details with "quotes" are fine here
> EOF
> ```

## 2. Pick the version number

Look at the latest tag in each repo (`git tag --sort=-v:refname | head -3`) and bump:

| Change                                              | Bump  | Example             |
| --------------------------------------------------- | ----- | ------------------- |
| Bug fixes only                                      | patch | `v1.1.0` → `v1.1.1` |
| New features / new API fields / new DB migrations   | minor | `v1.1.1` → `v1.2.0` |
| Breaking API change (old app versions stop working) | major | `v1.2.0` → `v2.0.0` |

The two repos have their own tags; using the same number for a joint release
keeps things readable.

## 3. Tag and push — server first

The web app calls the API, so publish the API first.

```bash
cd ~/dev/bytariv2/server
git pull
git tag -a vX.Y.Z -m "vX.Y.Z: short summary"
git push origin vX.Y.Z
```

Wait for **Actions → "Deploy API"** to finish green, then:

```bash
cd ~/dev/bytariv2/mobile
git pull
git tag -a vX.Y.Z -m "vX.Y.Z: short summary"
git push origin vX.Y.Z
```

Wait for **Actions → "Deploy Web"** to finish green.

## 4. What happens automatically on the VPS

`deploy/scripts/deploy.sh` (see DEPLOYMENT.md §9) does, in order:

1. validates `.env` and the compose config
2. pulls the new image
3. takes a **`pg_dump` backup** of the database (`/opt/bytari/backups/`)
4. runs **database migrations** + idempotent seeds with the new image
5. starts the new containers and waits for health checks
6. smoke-tests `/health`, `/health/ready`, `/` and a deep link
7. if step 5 or 6 fails, **automatically restores the previous images**

So you do **not** need to run migrations by hand.

## 5. After deploying — quick checks

```bash
curl -fsS https://api.baytari.com/health/ready
curl -fsSI https://baytari.com/ | head -1
```

Then open the web app, sign in, and click through what changed in this release.

## 6. Android / iOS apps

A tag does **not** update the phone apps. Build and submit them with EAS:

```bash
cd ~/dev/bytariv2/mobile
eas build --platform android --profile production
eas build --platform ios --profile production
eas submit --platform android   # / ios
```

A new native build is **required** whenever a native dependency was added
(e.g. `expo-camera` in v1.1.0). JS-only changes still need a new build unless
OTA updates are set up.

## 7. If something goes wrong

**The tag was pushed before CI was green** — its deploy fails and production is
untouched. Delete the tag, fix, and tag again:

```bash
git push --delete origin vX.Y.Z
git tag -d vX.Y.Z
```

**The new version is live but broken** — roll back the images on the VPS
(DEPLOYMENT.md §10):

```bash
ssh deploy@<VPS_HOST>
cd /opt/bytari
deploy/scripts/rollback.sh                                  # previous release
deploy/scripts/rollback.sh --api-tag vA.B.C --web-tag vA.B.C # a specific one
```

Rollback swaps images only; it does not undo migrations (they are additive, so
the old image still works). If a migration itself damaged data, restore the
pre-deploy backup (DEPLOYMENT.md §12).

## Release log

| Version | Date       | Notes                                                                                                                                                            |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.1.0  | 2026-09-26 | Registration/password reset, reviews & likes, farm corrections; 4 new migrations (`20261024010000`–`20261024040000`); mobile adds `expo-camera` (native rebuild) |
