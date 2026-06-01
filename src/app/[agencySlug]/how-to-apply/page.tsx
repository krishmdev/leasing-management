import { notFound } from "next/navigation";
import { publicAgency } from "@/server/domain/agency";
import { criteriaFor } from "@/server/domain/screening/criteria";

export const metadata = { title: "How to apply" };

export default async function HowToApply({ params }: { params: Promise<{ agencySlug: string }> }) {
  const agency = await publicAgency((await params).agencySlug);
  if (!agency) notFound();
  const c = criteriaFor(agency.city);
  const fairChance = c.jurisdictions.includes("oakland") || c.jurisdictions.includes("berkeley");

  return (
    <div className="mx-auto max-w-3xl px-5 pt-12">
      <h1 className="display mt-2 text-4xl font-semibold">How we review applications</h1>
      <p className="mt-4 text-lg text-ink-2">
        Every applicant is scored against the same written criteria, and the version in effect when you submit is the one we use.
        A person reviews every application that isn&apos;t a clear approval. We never decline anyone automatically.
      </p>

      <h2 className="display mt-12 text-2xl font-semibold">What we look at (100 points)</h2>
      <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-black/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
            <tr><th className="px-4 py-3">Factor</th><th className="px-4 py-3">How it&apos;s measured</th><th className="px-4 py-3 text-right">Points</th></tr>
          </thead>
          <tbody className="divide-y divide-black/5 bg-surface/60">
            <tr><td className="px-4 py-3 font-medium">Income</td><td className="px-4 py-3">Monthly income divided by <em>your portion</em> of the rent. Housing vouchers and other subsidies are subtracted first.</td><td className="px-4 py-3 text-right tabular">{c.weights.income}</td></tr>
            <tr><td className="px-4 py-3 font-medium">Credit</td><td className="px-4 py-3">A credit band from the screening company. No credit history is scored as neutral, not as a negative. If you use a subsidy you can offer other proof of ability to pay instead.</td><td className="px-4 py-3 text-right tabular">{c.weights.credit}</td></tr>
            <tr><td className="px-4 py-3 font-medium">Evictions</td><td className="px-4 py-3">Court judgments in the landlord&apos;s favor in the last {c.evictionLookbackYears} years. Any record goes to a person for review.</td><td className="px-4 py-3 text-right tabular">{c.weights.evictions}</td></tr>
            <tr><td className="px-4 py-3 font-medium">Collections</td><td className="px-4 py-3">Non-medical collections only. Medical debt and COVID-era rental debt are ignored.</td><td className="px-4 py-3 text-right tabular">{c.weights.collections}</td></tr>
            <tr><td className="px-4 py-3 font-medium">Rental references</td><td className="px-4 py-3">A short form your past landlords fill out.</td><td className="px-4 py-3 text-right tabular">{c.weights.references}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">
        {c.thresholds.approve}+ points is an approval. {c.thresholds.conditional}–{c.thresholds.approve - 1} is a conditional approval (usually a qualified
        guarantor). Anything lower, or any flag, goes to a leasing agent.
      </p>

      <h2 className="display mt-12 text-2xl font-semibold">What we never ask for</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ink-2">
        <li>Your Social Security number or date of birth. The screening company collects those on its own secure page, and they never reach us.</li>
        <li>Race, religion, national origin, sex, marital status, disability, or whether you have children.</li>
        {fairChance && <li>Criminal history. {agency.city} has a Fair Chance Housing ordinance, and we don&apos;t collect it anywhere.</li>}
      </ul>
      <p className="mt-3 text-sm text-ink-2">Assistance animals are not pets and aren&apos;t subject to pet rules or fees. Ask us about reasonable accommodations at any point.</p>

      <h2 className="display mt-12 text-2xl font-semibold">If we can&apos;t approve you</h2>
      <p className="mt-3 text-ink-2">
        You&apos;ll get a written notice with the main reasons, the name and contact details of the screening company, and your right to a free copy of
        your report within 60 days and to dispute anything in it.
      </p>
      <p className="mt-10 rounded-xl bg-surface p-4 text-xs text-muted ring-1 ring-black/5">
        These criteria include California-specific rules (SB 267, source-of-income protections, medical-debt exclusion) as implemented in this demo. They are
        not legal advice; verify with counsel before relying on them.
      </p>
    </div>
  );
}
