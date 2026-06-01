import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Not found</p>
        <h1 className="mt-3 text-2xl font-semibold">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-sm text-ink-2">If you followed a link from an email, it may have expired or already been used.</p>
        <Link href="/" className="mt-6 inline-flex min-h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-white">Go to the home page</Link>
      </div>
    </main>
  );
}
