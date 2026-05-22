/**
 * Timing for agent jobs. The invariant that matters: a step's lease outlives both the step's own
 * hard timeout and pg-boss's expiry for the job running it, so a retry can only reclaim a step
 * whose previous runner has certainly stopped.
 *
 *   hardTimeoutMs (60s) < queue expireInSeconds (90s) < leaseMs - 30s (120s)
 *   retryDelaySeconds (160s) > leaseMs, so a StepBusy retry lands after the lease has run out.
 */
export const STEP = {
  leaseMs: 150_000,
  hardTimeoutMs: 60_000,
  maxAttempts: 6,
  reapIdleMs: 10 * 60_000,
} as const;

export const AGENT_QUEUE = {
  expireInSeconds: 90,
  retryLimit: 8,
  retryDelay: 160,
  retryBackoff: false,
} as const;

if (STEP.hardTimeoutMs >= AGENT_QUEUE.expireInSeconds * 1000 || AGENT_QUEUE.expireInSeconds * 1000 + 30_000 > STEP.leaseMs || AGENT_QUEUE.retryDelay * 1000 <= STEP.leaseMs) {
  throw new Error("job timing invariants violated; see src/server/jobs/config.ts");
}
