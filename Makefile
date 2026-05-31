# Two phases. `make setup` needs the network (packages, browser, images, build). Everything
# after that runs offline; `make e2e-offline` proves it by running the whole app stack inside
# an egress-blocking sandbox (set OFFLINE_RUN to the wrapper command, see README).
OFFLINE_RUN ?=

.PHONY: setup up down demo test test-int e2e e2e-offline lint typecheck check clean

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
	@test -n "$(OFFLINE_RUN)" || { echo "set OFFLINE_RUN to an egress-blocking wrapper (e.g. a sandbox-exec script)"; exit 2; }
	E2E_OFFLINE=1 $(OFFLINE_RUN) ./scripts/e2e.sh

clean:
	docker compose down -v
	rm -rf .next storage
