# Two phases. `make setup` needs the network (packages, browser, images, build). Everything
# after that runs offline; `make e2e-offline` proves it by running the whole app stack inside
# an egress-blocking sandbox. On macOS that's scripts/offline-run (sandbox-exec with
# scripts/offline.sb); set OFFLINE_WRAPPER to use something else.
OFFLINE_WRAPPER ?=

.PHONY: setup up down demo test test-int e2e e2e-offline record-tests lint typecheck check clean

setup:
	pnpm install --frozen-lockfile
	pnpm exec playwright install chromium
	docker compose pull
	pnpm exec tsx scripts/bootstrap.ts --no-seed
	pnpm build

up:
	docker compose up -d --wait

down:
	docker compose down

# Seeded demo: web on :3041, worker, Mailpit on :8041.
demo: up
	pnpm exec tsx scripts/reset-db.ts
	pnpm db:seed
	pnpm exec concurrently -k -n web,worker "next start -p 3041" "tsx src/worker/index.ts"

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

test-int: up
	pnpm test:int

check: lint typecheck test test-int

# Unsandboxed run. The egress canary must CONNECT here, which shows the offline check is real.
e2e: up
	./scripts/e2e.sh

e2e-offline: up
	E2E_OFFLINE=1 $(or $(OFFLINE_WRAPPER),./scripts/offline-run) ./scripts/e2e.sh

record-tests: up
	OFFLINE_WRAPPER="$(or $(OFFLINE_WRAPPER),./scripts/offline-run)" ./scripts/record-tests.sh

clean:
	docker compose down -v
	rm -rf .next storage
