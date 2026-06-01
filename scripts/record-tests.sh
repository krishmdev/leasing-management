#!/bin/sh
# Runs unit, integration and offline e2e suites and writes the counts to results/tests.json.
#   OFFLINE_RUN=<egress-blocking wrapper> scripts/record-tests.sh
set -eu
cd "$(dirname "$0")/.."
if [ -z "${OFFLINE_RUN:-}" ]; then
  echo "OFFLINE_RUN must name the egress-blocking wrapper; refusing to record incomplete results." >&2
  exit 2
fi
if [ ! -x "$OFFLINE_RUN" ]; then
  echo "OFFLINE_RUN is not executable: $OFFLINE_RUN" >&2
  exit 2
fi
mkdir -p storage results
rm -f storage/unit.json storage/int.json storage/e2e-results.json
pnpm exec vitest run --reporter=json --outputFile=storage/unit.json
pnpm exec vitest run -c vitest.integration.config.mts --reporter=json --outputFile=storage/int.json
E2E_OFFLINE=1 "$OFFLINE_RUN" ./scripts/e2e.sh
node -e '
const fs = require("fs");
const v = (f) => {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const result = { passed: j.numPassedTests, failed: j.numFailedTests, suites: j.numTotalTestSuites };
  if (!Number.isInteger(result.passed) || !Number.isInteger(result.failed) || result.passed < 1 || result.failed !== 0) {
    throw new Error(`${f} did not pass cleanly: ${JSON.stringify(result)}`);
  }
  return result;
};
const unit = v("storage/unit.json");
const integration = v("storage/int.json");
const j = JSON.parse(fs.readFileSync("storage/e2e-results.json", "utf8"));
const e = { passed: j.stats.expected, failed: j.stats.unexpected, flaky: j.stats.flaky, offline: true };
if (!Number.isInteger(e.passed) || e.passed < 1 || e.failed !== 0 || e.flaky !== 0) {
  throw new Error(`offline E2E did not pass cleanly: ${JSON.stringify(e)}`);
}
const commit = require("child_process").execSync("git rev-parse --short HEAD").toString().trim();
fs.writeFileSync("results/tests.json", JSON.stringify({ recordedAt: new Date().toISOString(), commit, unit, integration, e2e: e }, null, 2) + "\n");
console.log(fs.readFileSync("results/tests.json", "utf8"));
'
