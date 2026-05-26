import { z } from "zod";

export type FormState = { ok?: boolean; message?: string; errors?: Record<string, string>; values?: Record<string, string> } | undefined;

/** zod issues -> { "residences.0.address": "Enter the address" } for inline field errors. */
export function fieldErrors(e: unknown): Record<string, string> | null {
  if (!(e instanceof z.ZodError)) return null;
  const out: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join(".");
    out[k] ??= i.message;
  }
  return out;
}

export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

export const checked = (fd: FormData, name: string) => fd.get(name) === "on" || fd.get(name) === "true";
