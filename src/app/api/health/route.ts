import net from "node:net";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

function tcpUp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 1500 });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.once("timeout", () => (s.destroy(), resolve(false)));
  });
}

export async function GET() {
  const out: Record<string, unknown> = {};
  try {
    await db().$queryRaw`SELECT 1`;
    out.db = "ok";
  } catch {
    out.db = "down";
  }
  out.smtp = (await tcpUp(process.env.SMTP_HOST ?? "127.0.0.1", Number(process.env.SMTP_PORT ?? 1041))) ? "ok" : "down";
  try {
    const rows = await db().$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pgboss.queue`;
    out.queue = rows.length ? "ok" : "down";
  } catch {
    out.queue = "not-initialized";
  }
  const ok = out.db === "ok" && out.smtp === "ok";
  return Response.json(out, { status: ok ? 200 : 503 });
}
