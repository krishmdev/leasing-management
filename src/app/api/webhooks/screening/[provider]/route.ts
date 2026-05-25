import { handleScreeningWebhook } from "@/server/domain/screening/webhook";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const r = await handleScreeningWebhook(provider, req);
  return Response.json(r.body, { status: r.status });
}
