import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

// Rendered only in the worker (never inside Next). Built-in Helvetica keeps output reproducible.
const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#1c1917", lineHeight: 1.45 },
  brand: { fontSize: 9, color: "#57534e", marginBottom: 18, textTransform: "uppercase", letterSpacing: 1 },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  sub: { fontSize: 10, color: "#57534e", marginBottom: 18 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #e7e5e4", paddingVertical: 4 },
  k: { width: "40%", color: "#57534e" },
  v: { width: "60%" },
  p: { marginBottom: 6 },
  small: { fontSize: 8, color: "#78716c" },
  box: { border: "0.75pt solid #d6d3d1", padding: 10, marginTop: 10 },
  footer: { position: "absolute", bottom: 28, left: 48, right: 48, fontSize: 7, color: "#a8a29e", flexDirection: "row", justifyContent: "space-between" },
});

export interface Meta {
  title: string;
  agencyName: string;
  /** Fixed from the source record so re-rendering produces the same bytes. */
  createdAt: Date;
  docRef: string;
}

function Shell({ meta, children }: { meta: Meta; children: ReactNode }) {
  return (
    <Document title={meta.title} author={meta.agencyName} creator="leasing-management" producer="leasing-management" creationDate={meta.createdAt} modificationDate={meta.createdAt}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.brand}>{meta.agencyName}</Text>
        {children}
        <View style={s.footer} fixed>
          <Text>{meta.docRef}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

const KV = ({ rows }: { rows: [string, string][] }) => (
  <View>
    {rows.map(([k, v]) => (
      <View key={k} style={s.row}>
        <Text style={s.k}>{k}</Text>
        <Text style={s.v}>{v}</Text>
      </View>
    ))}
  </View>
);

export interface LeaseData {
  meta: Meta;
  tenant: string;
  address: string;
  rent: string;
  deposit: string;
  start: string;
  end: string;
  jurisdiction: string;
  signature?: { typedName: string; signedAt: string; ip: string; docSha256: string; signatureId: string };
}

export function LeaseDoc({ d }: { d: LeaseData }) {
  return (
    <Shell meta={d.meta}>
      <Text style={s.h1}>Residential Lease Agreement</Text>
      <Text style={s.sub}>Sample template, not attorney-reviewed. For demonstration only.</Text>
      <KV rows={[["Landlord / agent", d.meta.agencyName], ["Tenant", d.tenant], ["Premises", d.address], ["Term", `${d.start} to ${d.end} (12 months)`], ["Monthly rent", d.rent], ["Security deposit", d.deposit]]} />
      <Text style={s.h2}>1. Rent</Text>
      <Text style={s.p}>Rent is due on the first day of each month. A late fee may apply only as permitted by {d.jurisdiction} law. Rent may be paid online through the resident portal.</Text>
      <Text style={s.h2}>2. Security deposit</Text>
      <Text style={s.p}>The deposit will be held and returned under California Civil Code section 1950.5, with an itemized statement within 21 days of move-out.</Text>
      <Text style={s.h2}>3. Maintenance and entry</Text>
      <Text style={s.p}>Tenant should report repairs through the resident portal. Except in an emergency, landlord gives at least 24 hours written notice before entering.</Text>
      <Text style={s.h2}>4. Assistance animals and accommodations</Text>
      <Text style={s.p}>Assistance animals are not pets and are not subject to pet rules or fees. Tenant may request a reasonable accommodation at any time.</Text>
      <Text style={s.h2}>5. Utilities</Text>
      <Text style={s.p}>Water and trash are included. Tenant is responsible for gas and electricity.</Text>
      {d.signature ? (
        <View style={s.box} break>
          <Text style={s.h1}>Signature certificate</Text>
          <KV rows={[["Signed by", d.signature.typedName], ["Signed at (UTC)", d.signature.signedAt], ["IP address", d.signature.ip], ["Signature id", d.signature.signatureId], ["Reviewed document SHA-256", d.signature.docSha256]]} />
          <Text style={[s.small, { marginTop: 8 }]}>The signer typed their name and agreed to sign electronically (ESIGN Act, California UETA). The hash identifies the exact lease document they reviewed before signing.</Text>
        </View>
      ) : (
        <View style={s.box}>
          <Text>Tenant signature: ______________________   Date: __________</Text>
          <Text style={s.small}>Sign online with the link in your email.</Text>
        </View>
      )}
    </Shell>
  );
}

export interface SummaryData {
  meta: Meta;
  applicant: string;
  unit: string;
  score: number;
  outcome: string;
  flags: string[];
  factors: { factor: string; points: number; max: number; detail: string }[];
  rationale: string;
  rationaleSource: string;
  criteriaVersion: number;
  steps: { name: string; status: string; ms: number | null }[];
}

export function SummaryDoc({ d }: { d: SummaryData }) {
  return (
    <Shell meta={d.meta}>
      <Text style={s.h1}>Application summary</Text>
      <Text style={s.sub}>{d.applicant} · {d.unit} · criteria v{d.criteriaVersion}</Text>
      <KV rows={[["Recommendation", d.outcome], ["Rubric score", `${d.score} / 100`], ["Flags", d.flags.length ? d.flags.join(", ") : "none"]]} />
      <Text style={s.h2}>Score breakdown</Text>
      <KV rows={d.factors.map((f) => [`${f.factor} (${f.points} / ${f.max})`, f.detail] as [string, string])} />
      <Text style={s.h2}>Rationale ({d.rationaleSource.toLowerCase()})</Text>
      <Text style={s.p}>{d.rationale}</Text>
      <Text style={s.h2}>Agent steps</Text>
      <KV rows={d.steps.map((x) => [x.name, `${x.status}${x.ms != null ? ` · ${x.ms} ms` : ""}`] as [string, string])} />
      <Text style={[s.small, { marginTop: 12 }]}>The score comes from a fixed rubric. The language model only reads reference text and can move at most 4.5 of 100 points. A person makes every decline.</Text>
    </Shell>
  );
}

export interface AdverseData {
  meta: Meta;
  kind: "DECLINE" | "CONDITIONAL";
  applicant: string;
  address: string;
  reasons: { text: string; basis: string }[];
  conditions?: string[];
  cra: { name: string; address: string; phone: string; website: string } | null;
  score: {
    value: number | null;
    band?: string;
    model: string | null;
    range: (number | null)[];
    keyFactors: string[];
    date: string | null;
  } | null;
  thirdParty: boolean;
}

export function AdverseActionDoc({ d }: { d: AdverseData }) {
  const isConditional = d.kind === "CONDITIONAL";
  return (
    <Shell meta={d.meta}>
      <Text style={s.h1}>{isConditional ? "Notice of conditional approval" : "Notice of adverse action"}</Text>
      <Text style={s.sub}>To {d.applicant} · re: {d.address}</Text>
      <Text style={s.p}>
        {isConditional
          ? "We approved your rental application on conditions (for example a qualified guarantor), which is less favorable than a standard approval. The principal reasons are:"
          : "We are unable to approve your rental application at this time. The principal reasons are:"}
      </Text>
      {d.reasons.map((r) => (
        <Text key={r.text} style={s.p}>• {r.text}</Text>
      ))}

      {isConditional && d.conditions && d.conditions.length > 0 && (
        <View style={s.box}>
          <Text style={s.h2}>Required conditions</Text>
          <Text style={s.p}>To complete your approval and execute a lease, the following terms and conditions must be satisfied:</Text>
          {d.conditions.map((c, i) => (
            <Text key={i} style={s.p}>• {c}</Text>
          ))}
        </View>
      )}

      {d.cra && (
        <View style={s.box}>
          <Text style={s.h2}>Consumer report disclosure (FCRA § 615(a))</Text>
          <Text style={s.p}>Our decision was based in whole or in part on information in a consumer report from:</Text>
          <Text>{d.cra.name}</Text>
          <Text>{d.cra.address}</Text>
          <Text>{d.cra.phone} · {d.cra.website}</Text>
          <Text style={[s.p, { marginTop: 6 }]}>
            The consumer reporting agency did not make this decision and cannot explain why it was made.
          </Text>

          {d.score && (
            <View style={{ marginTop: 8 }}>
              <Text style={s.h2}>Credit score used</Text>
              {d.score.value !== null ? (
                <KV
                  rows={[
                    ["Score", String(d.score.value)],
                    ["Credit band", d.score.band ?? "N/A"],
                    ["Range", `${d.score.range[0]} to ${d.score.range[1]}`],
                    ["Model", d.score.model ?? ""],
                    ["Date", d.score.date ?? ""],
                    ["Key factors", d.score.keyFactors.length > 0 ? d.score.keyFactors.join("; ") : "None reported"],
                  ]}
                />
              ) : (
                <View>
                  <KV
                    rows={[
                      ["Credit band", d.score.band ?? "THIN_FILE"],
                      ["Score", "No score available (thin file)"],
                      ["Range", d.score.range && d.score.range[0] != null ? `${d.score.range[0]} to ${d.score.range[1]}` : "N/A"],
                      ["Model", d.score.model ?? "N/A"],
                      ["Date", d.score.date ?? "N/A"],
                      ["Key factors", d.score.keyFactors.length > 0 ? d.score.keyFactors.join("; ") : "Insufficient credit history / lack of tradelines"],
                    ]}
                  />
                  <Text style={[s.p, { marginTop: 6 }]}>
                    Thin file notice: A numeric credit score was not available because of insufficient credit history or lack of credit file on record with the consumer reporting agency.
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={{ marginTop: 8 }}>
            <Text style={s.h2}>Statutory dispute & consumer rights</Text>
            <Text style={s.p}>
              • FCRA § 612 (Free consumer report): You have the right to obtain a free copy of your consumer report from the consumer reporting agency identified above, provided your request is made within 60 days after receiving this notice.
            </Text>
            <Text style={s.p}>
              • FCRA § 611 (Dispute accuracy and completeness): You have the right to dispute the accuracy or completeness of any information in the consumer report directly with the consumer reporting agency. The agency must investigate your dispute free of charge.
            </Text>
            <Text style={s.p}>
              • FCRA § 605A (Right to obtain a security freeze): You have the right to place a security freeze on your consumer credit report at no cost. A security freeze prohibits a consumer reporting agency from releasing information in your credit report without your express authorization, helping protect against identity theft.
            </Text>
            <Text style={s.p}>
              • California CCRAA disclosure (Cal. Civ. Code § 1785.20): Under the California Consumer Credit Reporting Agencies Act, whenever an adverse action is taken based in whole or in part on a credit report, you have the right to receive written notice of the action and the agency&apos;s contact details. You have the right to obtain a free copy of your report within 60 days and dispute incomplete or inaccurate information.
            </Text>
          </View>
        </View>
      )}

      {d.thirdParty && (
        <View style={s.box}>
          <Text style={s.h2}>Information from other sources (FCRA § 615(b))</Text>
          <Text style={s.p}>Our decision was based in whole or in part on information from a source other than a consumer reporting agency (prior landlord references). You may ask us in writing, within 60 days of this notice, for the nature of that information.</Text>
        </View>
      )}
      <Text style={[s.small, { marginTop: 16 }]}>Sample notice generated by the demo platform. Not legal advice; verify with counsel.</Text>
    </Shell>
  );
}
