#!/bin/sh
# Runs the whole stack (Next production server + worker) and the Playwright suite against a
# separate database. Meant to be wrapped in an egress-blocking sandbox, e.g.
#   $OFFLINE_RUN scripts/e2e.sh
# Postgres and Mailpit must already be up (docker compose up -d --wait).
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

E2E_PORT="${E2E_PORT:-3042}"
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://leasing:leasing@localhost:${PG_PORT:-5441}/leasing_e2e}"
export APP_URL="http://localhost:${E2E_PORT}"
export BETTER_AUTH_URL="$APP_URL"
export PORT="$E2E_PORT"
export LLM_PROVIDER=offline EMAIL_TRANSPORT=smtp EGRESS_CANARY=1 STORAGE_DIR=storage/e2e REMINDER_OFFSETS_MIN=1440,120 OUTBOX_POLL_MS=500
unset RESEND_API_KEY GEMINI_API_KEY OPENAI_API_KEY || true
export E2E_BASE_URL="$APP_URL"

[ -d .next ] || { echo "run 'pnpm build' first (make setup does)"; exit 1; }

pnpm exec tsx scripts/reset-db.ts
pnpm exec tsx prisma/seed/index.ts

lsof -ti :"$E2E_PORT" | xargs kill -9 2>/dev/null || true

pnpm exec next start -p "$E2E_PORT" > storage/e2e-web.log 2>&1 &
WEB=$!
pnpm exec tsx src/worker/index.ts > storage/e2e-worker.log 2>&1 &
WORKER=$!
trap 'pkill -P $WEB 2>/dev/null || true; kill $WEB $WORKER 2>/dev/null || true; lsof -ti :"$E2E_PORT" | xargs kill 2>/dev/null || true' EXIT INT TERM

i=0
# Wait for the web server, and for both processes to have recorded their egress canary.
health() { node -e 'fetch(process.argv[1]).then(r=>r.text()).then(t=>{process.exit(t.includes("\"worker\"")?0:1)}).catch(()=>process.exit(1))' "$APP_URL/api/health"; }
until health; do
  i=$((i + 1)); [ $i -gt 60 ] && { echo "web server didn't come up"; tail -30 storage/e2e-web.log; exit 1; }
  sleep 1
done

pnpm exec playwright test "$@"
