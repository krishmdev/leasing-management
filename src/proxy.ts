import { NextResponse, type NextRequest } from "next/server";

// Path-based tenancy (/bayview/...) is the main mechanism. This only maps the optional
// subdomain form, bayview.localhost:3041/listings -> /bayview/listings. No auth here.
const RESERVED = new Set(["www", "app", "dashboard", "api"]);

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const sub = host.split(":")[0].split(".");
  if (sub.length < 2 || sub.at(-1) !== "localhost") return NextResponse.next();
  const slug = sub[0];
  if (!/^[a-z0-9-]+$/.test(slug) || RESERVED.has(slug)) return NextResponse.next();
  const url = req.nextUrl.clone();
  if (url.pathname.startsWith(`/${slug}`) || url.pathname.startsWith("/api") || url.pathname.startsWith("/_next")) return NextResponse.next();
  url.pathname = `/${slug}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
