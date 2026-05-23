/**
 * MockCRA: a pretend third-party screening company, so the whole flow runs locally.
 *
 * It lives in its own Postgres schema and nothing in src/server/domain touches that schema; the
 * platform only talks to it through the ScreeningProvider adapter, as it would with a real
 * company's API. Its hosted page (app/mock-provider/[ref]) collects an SSN and date of birth in
 * the browser and never sends them anywhere: in a real integration those go to the screening
 * company, not to us, and here there is simply no request that carries them.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";

export const PERSONAS = {
  excellent: { label: "Excellent credit", band: "EXCELLENT", score: 792, evictions: 0, collections: [0, 0], idOk: true, incomeOk: true, factors: ["Long credit history", "Low utilization"] },
  good: { label: "Good credit", band: "GOOD", score: 712, evictions: 0, collections: [0, 0], idOk: true, incomeOk: true, factors: ["Moderate utilization", "Recent inquiry"] },
  fair: { label: "Fair credit, small collection", band: "FAIR", score: 641, evictions: 0, collections: [1, 60_000], idOk: true, incomeOk: true, factors: ["Collection account", "High utilization", "Short credit history"] },
  thin: { label: "No credit history (thin file)", band: "THIN_FILE", score: null, evictions: 0, collections: [0, 0], idOk: true, incomeOk: true, factors: [] },
  eviction: { label: "Eviction judgment", band: "GOOD", score: 688, evictions: 1, collections: [0, 0], idOk: true, incomeOk: true, factors: ["Public record"] },
  poor: { label: "Poor credit, collections", band: "POOR", score: 548, evictions: 0, collections: [2, 240_000], idOk: true, incomeOk: true, factors: ["Delinquent accounts", "Collection accounts", "High utilization", "Recent late payments"] },
} as const;
export type Persona = keyof typeof PERSONAS;

export const DISCLOSURE = {
  name: "MockCRA Consumer Reports (demo)",
  address: "100 Example Plaza, Suite 400, Sacramento, CA 95814",
  phone: "(800) 555-0100",
  website: "https://mockcra.invalid/consumers",
};

export interface Invitation {
  ref: string;
  client_reference: string;
  idempotency_key: string | null;
  status: string;
  persona: Persona | null;
  report_id: string | null;
  callback_url: string;
  rent_cents: number;
  created_at: Date;
}

const honorsIdempotency = () => process.env.MOCKCRA_HONOR_IDEMPOTENCY !== "0";

/** Like a real provider API: with an Idempotency-Key header a repeat create returns the original. */
export async function createInvitation(i: { clientReference: string; idempotencyKey?: string; applicantEmail: string; rentCents: number; callbackUrl: string }) {
  const key = honorsIdempotency() ? (i.idempotencyKey ?? null) : null;
  if (key) {
    const [existing] = await db().$queryRaw<Invitation[]>`SELECT * FROM mockcra.invitation WHERE idempotency_key = ${key}`;
    if (existing) return existing;
  }
  const ref = `mcra_${randomBytes(9).toString("base64url")}`;
  const emailSha = createHash("sha256").update(i.applicantEmail.toLowerCase()).digest("hex");
  const [row] = await db().$queryRaw<Invitation[]>`
    INSERT INTO mockcra.invitation (ref, client_reference, idempotency_key, applicant_email_sha256, rent_cents, callback_url)
    VALUES (${ref}, ${i.clientReference}, ${key}, ${emailSha}, ${i.rentCents}, ${i.callbackUrl})
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
    RETURNING *`;
  return row;
}

export async function getInvitation(ref: string) {
  const [row] = await db().$queryRaw<Invitation[]>`SELECT * FROM mockcra.invitation WHERE ref = ${ref}`;
  return row ?? null;
}

export async function findByIdempotencyKey(key: string) {
  const [row] = await db().$queryRaw<Invitation[]>`SELECT * FROM mockcra.invitation WHERE idempotency_key = ${key}`;
  return row ?? null;
}

export async function findByClientReference(clientRef: string) {
  return db().$queryRaw<Invitation[]>`SELECT * FROM mockcra.invitation WHERE client_reference = ${clientRef} ORDER BY created_at`;
}

export async function countInvitations(clientRef: string) {
  const [r] = await db().$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM mockcra.invitation WHERE client_reference = ${clientRef}`;
  return Number(r.n);
}

/** The applicant finished the hosted flow. Only the persona choice and consent arrive here. */
export async function completeHostedFlow(ref: string, persona: Persona) {
  if (!(persona in PERSONAS)) throw new Error("unknown persona");
  const reportId = `rpt_${randomBytes(8).toString("hex")}`;
  const rows = await db().$queryRaw<Invitation[]>`
    UPDATE mockcra.invitation SET status = 'COMPLETE', persona = ${persona}, report_id = ${reportId}, completed_at = now()
    WHERE ref = ${ref} AND status <> 'COMPLETE' RETURNING *`;
  const inv = rows[0] ?? (await getInvitation(ref));
  if (!inv) throw new Error("unknown invitation");
  const eventId = `evt_${createHash("sha256").update(`${inv.ref}:COMPLETE`).digest("hex").slice(0, 20)}`;
  await db().$executeRaw`INSERT INTO mockcra.webhook_delivery (event_id, ref, event) VALUES (${eventId}, ${inv.ref}, 'COMPLETE') ON CONFLICT DO NOTHING`;
  return { inv, eventId };
}

export function signWebhook(body: string, secret = process.env.MOCKCRA_WEBHOOK_SECRET ?? "") {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyWebhookSignature(body: string, sig: string | null, secret = process.env.MOCKCRA_WEBHOOK_SECRET ?? "") {
  if (!sig || !secret) return false;
  const want = Buffer.from(signWebhook(body, secret), "hex");
  const got = Buffer.from(sig, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** POST the signed webhook to the platform, the way the real provider would. Retries are the caller's job. */
export async function deliverWebhook(inv: Invitation, eventId: string) {
  const body = JSON.stringify({ id: eventId, type: "screening.completed", ref: inv.ref, reportId: inv.report_id });
  const res = await fetch(inv.callback_url, { method: "POST", headers: { "content-type": "application/json", "x-mockcra-signature": signWebhook(body) }, body });
  if (res.ok) await db().$executeRaw`UPDATE mockcra.webhook_delivery SET delivered_at = now() WHERE event_id = ${eventId}`;
  return res.status;
}

/** Derived summary only. No raw tradelines, no SSN, no DOB: there are none to return. */
export async function reportSummary(ref: string) {
  const inv = await getInvitation(ref);
  if (!inv || inv.status !== "COMPLETE" || !inv.persona) throw new Error("report not ready");
  const p = PERSONAS[inv.persona];
  return {
    reportId: inv.report_id!,
    creditBand: p.band,
    creditScore: p.score,
    scoreModel: p.score ? "VantageScore 4.0 (simulated)" : null,
    scoreRange: p.score ? ([300, 850] as [number, number]) : null,
    keyFactors: [...p.factors].slice(0, 4),
    scoreDate: inv.created_at.toISOString().slice(0, 10),
    evictionJudgmentsInLookback: p.evictions,
    collectionsNonMedicalCount: p.collections[0],
    collectionsNonMedicalCents: p.collections[1],
    identityVerified: p.idOk,
    incomeVerified: p.incomeOk,
  };
}
