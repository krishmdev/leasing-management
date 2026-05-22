import { healthReport } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const { ok, body } = await healthReport();
  return Response.json(body, { status: ok ? 200 : 503 });
}
