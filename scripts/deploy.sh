#!/usr/bin/env bash
#
# Vercel build entrypoint. Wired through the "vercel-build" script in
# package.json, so Vercel runs this automatically with no dashboard config:
# apply any pending database migrations, then build.
#
# `scripts/migrate.mjs` is idempotent — with nothing to apply it just prints
# "nada a fazer" and exits 0 — and it talks to Neon over WSS/443, so it works
# from Vercel's build step regardless of egress rules.

set -euo pipefail

should_migrate() {
  # Production deploys always migrate. Preview / branch builds only when asked,
  # so a feature branch can't push a schema change to the shared database
  # before its code is live. A plain local `npm run build` never migrates.
  [ "${VERCEL_ENV:-}" = "production" ] || [ "${RUN_MIGRATIONS:-}" = "1" ]
}

if [ -z "${DATABASE_URL:-}" ]; then
  echo "deploy: DATABASE_URL not set — skipping migrations"
elif should_migrate; then
  echo "deploy: applying migrations"
  node scripts/migrate.mjs
else
  echo "deploy: VERCEL_ENV='${VERCEL_ENV:-}' — skipping migrations (set RUN_MIGRATIONS=1 to force)"
fi

echo "deploy: next build"
exec npx --no-install next build
