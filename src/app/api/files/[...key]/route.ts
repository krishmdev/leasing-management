import { headers } from "next/headers";
import { db } from "@/server/db";
import { auth } from "@/server/auth";
import { getObject } from "@/server/storage";

/** Ticket photos: staff of the agency, or the resident who filed the ticket. */
export async function GET(_: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  const photo = await db().ticketPhoto.findFirst({ where: { OR: [{ storageKey: key }, { thumbKey: key }] }, include: { ticket: true } });
  if (!photo) return new Response("not found", { status: 404 });
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return new Response("sign in", { status: 401 });
  const member = await db().member.findFirst({ where: { organizationId: photo.agencyId, userId: session.user.id } });
  if (!member && photo.ticket.reporterUserId !== session.user.id) return new Response("forbidden", { status: 403 });
  return new Response(new Uint8Array(await getObject(key)), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=3600" } });
}
