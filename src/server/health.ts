import net from "node:net";
import { db } from "@/server/db";

function tcpUp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 1500 });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.once("timeout", () => (s.destroy(), resolve(false)));
  });
}

export async function healthReport() {
  const out: Record<string, unknown> = {};
  try {
    await db().$queryRaw`SELECT 1`;
    out.db = "ok";
  } catch {
    out.db = "down";
  }
  out.smtp = (await tcpUp(process.env.SMTP_HOST ?? "127.0.0.1", Number(process.env.SMTP_PORT ?? 1041))) ? "ok" : "down";
  try {
    await db().$queryRaw`SELECT 1 FROM pgboss.queue LIMIT 1`;
    out.queue = "ok";
  } catch {
    out.queue = "not-initialized";
  }
  const checks = await db().processCheck.findMany({ where: { check: "egress" }, orderBy: { createdAt: "desc" }, take: 10 });
  const latest = new Map<string, { ok: boolean; at: Date }>();
  for (const c of checks) if (!latest.has(c.process)) latest.set(c.process, { ok: c.ok, at: c.createdAt });
  out.egress = Object.fromEntries([...latest].map(([p, v]) => [p, v.ok ? "blocked" : "OPEN"]));
  return { ok: out.db === "ok" && out.smtp === "ok", body: out };
}
