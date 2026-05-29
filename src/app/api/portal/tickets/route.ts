import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { agencyBySlug } from "@/server/tenant";
import { createTicket, MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/server/domain/maintenance/tickets";
import { residencyFor } from "@/server/domain/maintenance/portal";
import { fieldErrors } from "@/lib/forms";

// Photo uploads go through a route handler rather than a server action, so the 1 MB server
// action body limit doesn't apply. Each file is checked by its bytes, then re-encoded.
export async function POST(req: Request) {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const fd = await req.formData();
  const org = await agencyBySlug(String(fd.get("agency") ?? ""));
  if (!org) return Response.json({ error: "Unknown agency" }, { status: 404 });
  const residency = await residencyFor(org.id, session.user.id);
  if (!residency) return Response.json({ error: "We couldn't find a current lease for your account." }, { status: 403 });
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_PHOTOS) return Response.json({ error: `Up to ${MAX_PHOTOS} photos.` }, { status: 400 });
  if (files.some((f) => f.size > MAX_PHOTO_BYTES)) return Response.json({ error: "Each photo must be under 10 MB." }, { status: 400 });
  try {
    const r = await createTicket(
      org.id,
      { residencyId: residency.id, unitId: residency.unitId, reporterUserId: session.user.id },
      { title: String(fd.get("title") ?? ""), description: String(fd.get("description") ?? ""), permissionToEnter: fd.get("permissionToEnter") === "on" },
      await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer()))),
    );
    return Response.json(r);
  } catch (e) {
    const errors = fieldErrors(e);
    if (errors) return Response.json({ error: "Check the highlighted fields.", errors }, { status: 422 });
    // Only our own validation messages go back to the browser; anything else is logged.
    const known = e instanceof Error && /^(Photos must|At most)/.test(e.message);
    if (!known) console.error("ticket create failed:", e);
    return Response.json({ error: known ? (e as Error).message : "We couldn't file the request. Please try again, or call the office." }, { status: known ? 400 : 500 });
  }
}
