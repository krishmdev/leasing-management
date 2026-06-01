"use client";

export default function AgencyError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-20 text-center" role="alert">
      <h1 className="display text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-ink-2">Nothing you entered was lost if you&apos;d already saved it. Please try again.</p>
      <button onClick={reset} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-brand-ink">Try again</button>
    </div>
  );
}
