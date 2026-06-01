import { loadDocumentFor } from "@/server/docAccess";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadDocumentFor(id, new URL(req.url).searchParams.get("t"));
  if (!r) return new Response("not found", { status: 404 });
  if (r === "forbidden") return new Response("forbidden", { status: 403 });
  if (r === "purged") return new Response("This document was removed under the retention policy.", { status: 410 });
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${r.doc.kind.toLowerCase()}-${r.doc.id.slice(-8)}.pdf"`,
      "x-document-sha256": r.doc.sha256,
      "cache-control": "private, no-store",
    },
  });
}
