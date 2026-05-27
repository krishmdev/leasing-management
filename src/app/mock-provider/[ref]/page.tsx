import { notFound } from "next/navigation";
import { getInvitation, PERSONAS } from "@/mock-cra/service";
import { HostedForm } from "./HostedForm";

export const metadata = { title: "MockCRA · Identity verification" };

/** Deliberately not the agency's look: this stands in for a third-party screening site. */
export default async function MockProvider({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const inv = await getInvitation(ref);
  if (!inv) notFound();
  return (
    <main className="min-h-dvh bg-[#eef3f8] font-sans text-[#0b2239]">
      <header className="bg-[#0b2239] text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <p className="font-mono text-sm tracking-widest">MOCKCRA<span className="text-[#49c5b6]">●</span> consumer reports</p>
          <p className="text-xs text-white/60">Demo screening company · not a real CRA</p>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-2xl font-semibold">Verify your identity for a rental screening</h1>
        <p className="mt-2 text-sm text-[#3b5068]">
          A property manager asked us for a screening report. You enter identity details here, with us. The property manager only receives a summary
          (a credit band, eviction and collection counts) and a report id.
        </p>
        {inv.status === "COMPLETE" ? (
          <p className="mt-8 rounded-lg bg-white p-5 shadow-sm">This screening is complete. You can close this page.</p>
        ) : (
          <HostedForm ref_={ref} personas={Object.entries(PERSONAS).map(([k, p]) => ({ key: k, label: p.label }))} />
        )}
      </div>
    </main>
  );
}
