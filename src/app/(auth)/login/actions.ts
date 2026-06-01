"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/server/auth";
import { staffMemberships } from "@/server/session";
import { homeFor } from "@/server/access";
import type { FormState } from "@/lib/forms";

const safeNext = (n: FormDataEntryValue | null) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : null);

export async function staffSignIn(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { message: "Enter your email and password.", values: { email } };
  let userId: string;
  try {
    const r = await auth().api.signInEmail({ body: { email, password }, headers: await headers() });
    userId = r.user.id;
  } catch {
    return { message: "That email and password don't match.", values: { email } };
  }
  const next = safeNext(fd.get("next"));
  if (next) redirect(next);
  const m = await staffMemberships(userId);
  redirect(m[0] ? homeFor(m[0].organization.slug, m[0].role) : "/");
}

export async function sendMagicLink(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.email().safeParse(String(fd.get("email") ?? "").trim());
  if (!parsed.success) return { message: "Enter a valid email.", values: { email: String(fd.get("email") ?? "") } };
  const next = safeNext(fd.get("next")) ?? "/";
  await auth().api.signInMagicLink({ body: { email: parsed.data, callbackURL: next }, headers: await headers() });
  redirect(`/check-email?to=${encodeURIComponent(parsed.data)}`);
}

export async function signOut() {
  await auth().api.signOut({ headers: await headers() });
  redirect("/login");
}
