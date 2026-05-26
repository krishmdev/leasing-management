import type { Metadata } from "next";
import Link from "next/link";
import { LoginForms } from "./LoginForms";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const demo = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Leasing Desk
        </Link>
        <LoginForms next={next ?? ""} />
        {demo && (
          <div className="mt-6 rounded-lg border border-dashed border-line-strong p-4 text-xs text-ink-2">
            <p className="font-semibold text-ink">Demo accounts</p>
            <ul className="mt-2 space-y-1 font-mono">
              <li>owner@bayview.test (Assisted)</li>
              <li>agent@bayview.test</li>
              <li>maintenance@bayview.test</li>
              <li>owner@peninsula.test (Autonomous)</li>
            </ul>
            <p className="mt-2">
              Password <span className="font-mono">demo-password-2026</span>. Sign-in links arrive in{" "}
              <a className="underline" href={process.env.MAILPIT_URL ?? "http://localhost:8041"}>Mailpit</a>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
