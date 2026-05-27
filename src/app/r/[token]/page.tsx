import { notFound } from "next/navigation";
import { referenceByToken } from "@/server/domain/references/service";
import { dayLabel } from "@/lib/format";
import { ReferenceForm } from "./ReferenceForm";

export const metadata = { title: "Rental reference" };

export default async function Reference({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await referenceByToken(token);
  if (!r) notFound();
  return (
    <main className="min-h-dvh bg-paper px-4 py-12">
      <div className="mx-auto max-w-xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Rental reference · {r.agencyName}</p>
        <h1 className="mt-3 text-2xl font-semibold">How was {r.applicant} as a tenant?</h1>
        <p className="mt-2 text-sm text-ink-2">
          {r.address} · {dayLabel(r.startDate, { month: "short", year: "numeric" })} to {r.endDate ? dayLabel(r.endDate, { month: "short", year: "numeric" }) : "present"}. Two minutes. Please stick to rental history:
          payments, care of the unit, and the lease. Don&apos;t mention family, health, religion, background or anything personal.
        </p>
        {r.status === "COMPLETED" || r.status === "EXPIRED" ? (
          <p className="mt-8 rounded-lg bg-surface p-5 ring-1 ring-line">{r.status === "COMPLETED" ? "This reference was already submitted. Thank you." : "This link has expired."}</p>
        ) : (
          <ReferenceForm token={token} />
        )}
      </div>
    </main>
  );
}
