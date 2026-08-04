#!/usr/bin/env bash
# Installs a React build tarball into the Nginx web root atomically.
#
# The frontend is built on your machine (see DEPLOYMENT.md step 7) rather than on
# EC2 — `vite build` on this dependency set (three, pdfjs-dist, recharts) peaks
# well above the memory a t3.micro has, and a build that OOMs halfway leaves a
# partial dist/ behind.
#
# Usage on the server:
#   ./install-frontend.sh ~/frontend-dist.tar.gz

set -euo pipefail

TARBALL="${1:-}"
WEB_ROOT="/var/www/morainmahj-frontend"

if [[ -z "${TARBALL}" || ! -f "${TARBALL}" ]]; then
  echo "Usage: $0 <path-to-frontend-dist.tar.gz>" >&2
  exit 1
fi

STAGING="$(mktemp -d)"
trap 'rm -rf "${STAGING}"' EXIT

echo "==> Extracting ${TARBALL}"
tar -xzf "${TARBALL}" -C "${STAGING}"

# Accept either a tarball of dist/ itself or of its contents.
SOURCE="${STAGING}"
if [[ -d "${STAGING}/dist" ]]; then
  SOURCE="${STAGING}/dist"
fi

if [[ ! -f "${SOURCE}/index.html" ]]; then
  echo "!! No index.html found in the tarball. Did you archive the wrong directory?" >&2
  exit 1
fi

# Swap by rename so Nginx never serves a half-written directory. The old build
# is kept as .old until the next deploy, which makes rollback a single mv.
echo "==> Installing to ${WEB_ROOT}"
sudo mkdir -p "$(dirname "${WEB_ROOT}")"
sudo rm -rf "${WEB_ROOT}.old"
if [[ -d "${WEB_ROOT}" ]]; then
  sudo mv "${WEB_ROOT}" "${WEB_ROOT}.old"
fi
sudo mv "${SOURCE}" "${WEB_ROOT}"
sudo chown -R www-data:www-data "${WEB_ROOT}"
sudo find "${WEB_ROOT}" -type d -exec chmod 755 {} \;
sudo find "${WEB_ROOT}" -type f -exec chmod 644 {} \;

echo "==> Reloading Nginx"
sudo nginx -t
sudo systemctl reload nginx

echo "==> Frontend deployed. Previous build kept at ${WEB_ROOT}.old"
