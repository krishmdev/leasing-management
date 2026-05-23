import net from "node:net";
import { db } from "@/server/db";

// Same targets as the shared portfolio canary (.tools/egress_canary.py).
const TARGETS: [string, number][] = [
  ["1.1.1.1", 443],
  ["api.openai.com", 443],
  ["generativelanguage.googleapis.com", 443],
  ["huggingface.co", 443],
];

function tryConnect(host: string, port: number, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: timeoutMs });
    s.once("connect", () => (s.destroy(), resolve("connected")));
    s.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
    s.once("timeout", () => (s.destroy(), resolve("timeout")));
  });
}

/** Try to reach the internet from inside this process. `blocked` is true only if every attempt failed. */
export async function egressCanary() {
  const results = await Promise.all(TARGETS.map(async ([h, p]) => [`${h}:${p}`, await tryConnect(h, p)] as const));
  const open = results.filter(([, r]) => r === "connected").map(([t]) => t);
  return { blocked: open.length === 0, open, results: Object.fromEntries(results) };
}

/** Run the canary and record it, so /api/health and the e2e suite can see what each process saw. */
export async function recordEgressCanary(processName: string) {
  const r = await egressCanary();
  await db().processCheck.create({ data: { process: processName, check: "egress", ok: r.blocked, detail: r } });
  console.log(`[${processName}] egress canary: ${r.blocked ? "blocked" : `OPEN to ${r.open.join(", ")}`}`);
  return r;
}
