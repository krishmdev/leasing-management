"use client";

import { Card } from "@/components/ui";

export default function DeskError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg p-6" role="alert">
      <h1 className="text-lg font-semibold">Something went wrong loading this page</h1>
      <p className="mt-1 text-sm text-ink-2">Nothing was changed. Try again; if it keeps happening, the worker or database may be down.</p>
      <button onClick={reset} className="mt-4 inline-flex min-h-9 items-center rounded-md bg-ink px-3 text-sm font-medium text-white">Try again</button>
    </Card>
  );
}
