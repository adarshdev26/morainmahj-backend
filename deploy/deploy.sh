#!/usr/bin/env bash
# Backend deploy script. Lives on EC2 at ~/deploy.sh, which is what
# .github/workflows/deploy.yml executes over SSH after a push to main.
#
# Install once:
#   cp /var/www/morainmahj-backend/deploy/deploy.sh ~/deploy.sh
#   chmod +x ~/deploy.sh
#
# Set RUN_MIGRATIONS=1 to apply migrations/ as part of the deploy. It is off by
# default because a failed migration mid-deploy is far harder to recover from
# than running `npm run migrate` by hand after watching the diff.

set -euo pipefail

APP_DIR="/var/www/morainmahj-backend"
APP_NAME="morainmahj-api"
BRANCH="${BRANCH:-main}"

echo "==> Deploying ${APP_NAME} from ${BRANCH}"
cd "${APP_DIR}"

# Refuse to clobber uncommitted edits made directly on the server; they are
# almost always a hotfix someone forgot to push back.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "!! Working tree at ${APP_DIR} has uncommitted changes. Aborting." >&2
  git status --short >&2
  exit 1
fi

PREVIOUS_SHA="$(git rev-parse HEAD)"
echo "==> Current commit: ${PREVIOUS_SHA}"

git fetch --prune origin "${BRANCH}"
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"
echo "==> Updated to: $(git rev-parse HEAD)"

# npm ci respects package-lock.json exactly; --omit=dev keeps nodemon and the
# test tooling off the box.
echo "==> Installing dependencies"
npm ci --omit=dev

if [[ "${RUN_MIGRATIONS:-0}" == "1" ]]; then
  echo "==> Running migrations"
  npm run migrate
fi

# reload is zero-downtime when the process is already known to PM2; the first
# deploy has nothing to reload, so fall back to starting it.
echo "==> Restarting process"
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 reload "${APP_NAME}" --update-env
else
  pm2 start ecosystem.config.js --env production
fi
pm2 save

# Give the process a moment to bind, then confirm it actually serves traffic.
echo "==> Health check"
sleep 3
for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null; then
    echo "==> Healthy. Deploy complete: $(git rev-parse --short HEAD)"
    exit 0
  fi
  echo "   attempt ${attempt} failed, retrying..."
  sleep 2
done

echo "!! Health check failed. Rolling back to ${PREVIOUS_SHA}" >&2
git reset --hard "${PREVIOUS_SHA}"
npm ci --omit=dev
pm2 reload "${APP_NAME}" --update-env || pm2 start ecosystem.config.js --env production
echo "!! Rolled back. Check: pm2 logs ${APP_NAME} --lines 50" >&2
exit 1
