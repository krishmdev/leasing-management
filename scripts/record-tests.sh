#!/bin/sh
# Runs unit, integration and offline e2e suites and writes the counts to results/tests.json.
#   OFFLINE_RUN=<egress-blocking wrapper> scripts/record-tests.sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p storage results
pnpm exec vitest run --reporter=json --outputFile=storage/unit.json >/dev/null 2>&1 || true
pnpm exec vitest run -c vitest.integration.config.mts --reporter=json --outputFile=storage/int.json >/dev/null 2>&1 || true
if [ -n "${OFFLINE_RUN:-}" ]; then E2E_OFFLINE=1 $OFFLINE_RUN ./scripts/e2e.sh >/dev/null 2>&1 || true; fi
node -e '
const fs = require("fs");
const v = (f) => { try { const j = JSON.parse(fs.readFileSync(f)); return { passed: j.numPassedTests, failed: j.numFailedTests, suites: j.numTotalTestSuites }; } catch { return null; } };
const e = (() => { try { const j = JSON.parse(fs.readFileSync("storage/e2e-results.json")); return { passed: j.stats.expected, failed: j.stats.unexpected, flaky: j.stats.flaky, offline: !!process.env.OFFLINE_RUN }; } catch { return null; } })();
const commit = require("child_process").execSync("git rev-parse --short HEAD").toString().trim();
fs.writeFileSync("results/tests.json", JSON.stringify({ recordedAt: new Date().toISOString(), commit, unit: v("storage/unit.json"), integration: v("storage/int.json"), e2e: e }, null, 2) + "\n");
console.log(fs.readFileSync("results/tests.json", "utf8"));
'
