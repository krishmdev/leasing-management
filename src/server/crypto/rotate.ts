import { db } from "@/server/db";
import { envelopeKeyId, reencryptField } from "./fieldEncryption";
import { keys } from "./keyProvider";

/** Every encrypted column in the schema. tests/unit/relations.test.ts checks this list is complete. */
export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  Lead: ["nameEnc", "emailEnc", "phoneEnc"],
  IndicationOfInterest: ["messageEnc"],
  Application: ["legalNameEnc", "phoneEnc"],
  ResidenceHistory: ["addressEnc", "landlordNameEnc", "landlordEmailEnc", "landlordPhoneEnc"],
  ReferenceResponse: ["freeTextEnc"],
  ScreeningResult: ["creditScoreEnc"],
  LlmCall: ["redactedInputEnc"],
};

type Delegate = {
  findMany(a: object): Promise<Record<string, unknown>[]>;
  update(a: object): Promise<unknown>;
};

/**
 * Re-encrypt every field not already under the active key. The record binding (agency, model,
 * id, field) doesn't change; the keyId part of the AAD does, because the envelope names the key.
 * Old keys must stay in PII_KEYRING until this has run.
 */
export async function rotateAll(opts: { dryRun: boolean; batch?: number }) {
  const active = keys().activeKeyId();
  const report: Record<string, number> = {};
  const failures: { model: string; id: string; field: string }[] = [];
  for (const [model, cols] of Object.entries(ENCRYPTED_FIELDS)) {
    const delegate = (db() as unknown as Record<string, Delegate>)[model[0].toLowerCase() + model.slice(1)];
    let cursor: string | undefined;
    let changed = 0;
    for (;;) {
      const rows = await delegate.findMany({ take: opts.batch ?? 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } });
      if (!rows.length) break;
      for (const r of rows) {
        const data: Record<string, string> = {};
        for (const c of cols) {
          const v = r[c];
          if (typeof v !== "string" || v === "" || envelopeKeyId(v) === active) continue;
          try {
            data[c] = reencryptField({ agencyId: String(r.agencyId), model, id: String(r.id), field: c }, v);
          } catch {
            // A value that doesn't decrypt under its own record binding was tampered with or
            // copied from elsewhere. Leave it and report it; rotation must not launder it.
            failures.push({ model, id: String(r.id), field: c });
          }
        }
        if (Object.keys(data).length) {
          changed++;
          if (!opts.dryRun) await delegate.update({ where: { id: r.id }, data });
        }
      }
      cursor = String(rows.at(-1)!.id);
    }
    report[model] = changed;
  }
  return { rows: report, failures };
}
