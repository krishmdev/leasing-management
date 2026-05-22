import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

const handler = () => toNextJsHandler(auth());

// The organization plugin exposes endpoints for creating orgs, inviting members and changing
// roles. None of that is done through Better Auth here, so refuse them outright.
function blocked(req: Request) {
  const path = new URL(req.url).pathname;
  return path.startsWith("/api/auth/organization/") && !path.endsWith("/get-full-organization") && !path.endsWith("/list");
}

export async function GET(req: Request) {
  return handler().GET(req);
}

export async function POST(req: Request) {
  if (blocked(req)) return Response.json({ error: "not available" }, { status: 404 });
  return handler().POST(req);
}
