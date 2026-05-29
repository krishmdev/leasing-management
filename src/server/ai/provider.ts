import { generateText, Output, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import { canonicalJson, sha256Hex } from "@/server/crypto/tokens";
import { encryptField } from "@/server/crypto/fieldEncryption";
import { tenantDb } from "@/server/tenant";
import {
  Rationale, RationaleDTO, ReferenceAnalysis, ReferenceDTO, TriageDTO, TriageResult,
} from "./guardrails/dto";
import { mentionsProtected } from "./guardrails/redact";
import { offlineAnalyzeReference, offlineTriage, templateRationale } from "./offline";
import {
  RATIONALE_PROMPT_VERSION, REFERENCE_PROMPT_VERSION, TRIAGE_PROMPT_VERSION, rationalePrompt, referencePrompt, triagePrompt,
} from "./prompts/v1";

export type ProviderId = "offline" | "gemini" | "openai";

export function providerConfig(): { provider: ProviderId; model: string } {
  const p = (process.env.LLM_PROVIDER ?? "offline") as ProviderId;
  if (p === "gemini") return { provider: p, model: process.env.LLM_MODEL || "gemini-3.5-flash-lite" };
  if (p === "openai") return { provider: p, model: process.env.LLM_MODEL || "gpt-5.4-mini" };
  return { provider: "offline", model: "lexicon-v1" };
}

function languageModel(): LanguageModel | null {
  const { provider, model } = providerConfig();
  if (provider === "gemini") return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(model);
  if (provider === "openai") return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model);
  return null;
}

interface CallMeta {
  agencyId: string;
  applicationId?: string | null;
  purpose: string;
  promptVersion: string;
}

/**
 * One guarded model call: typed DTO in (already redacted), schema-checked object out, logged to
 * LlmCall with only a hash of the input and an encrypted copy of the redacted prompt. Results
 * are cached by (input hash, prompt version, model), so a retried step doesn't pay twice.
 */
async function call<T>(
  meta: CallMeta,
  dto: unknown,
  schema: z.ZodType<T>,
  prompt: { system: string; prompt: string },
  offline: () => T,
  signal?: AbortSignal,
): Promise<{ value: T; provider: string; model: string; cached: boolean }> {
  const { provider, model } = providerConfig();
  const inputHash = sha256Hex(canonicalJson({ dto, v: meta.promptVersion, model }));
  const t = tenantDb(meta.agencyId);
  const hit = await t.llmCall.findFirst({ where: { inputHash, promptVersion: meta.promptVersion, model }, orderBy: { createdAt: "desc" } });
  if (hit) return { value: schema.parse(hit.output), provider: hit.provider, model: hit.model, cached: true };

  const started = Date.now();
  let value: T;
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  const lm = languageModel();
  if (!lm) {
    value = offline();
  } else {
    const res = await generateText({ model: lm, system: prompt.system, prompt: prompt.prompt, output: Output.object({ schema }), abortSignal: signal, maxRetries: 1 });
    value = schema.parse(res.output);
    usage = res.usage ?? {};
  }
  const id = uuidv7();
  await t.llmCall.create({
    data: {
      id,
      agencyId: meta.agencyId,
      applicationId: meta.applicationId ?? null,
      purpose: meta.purpose,
      promptVersion: meta.promptVersion,
      provider,
      model,
      inputHash,
      redactedInputEnc: encryptField({ agencyId: meta.agencyId, model: "LlmCall", id, field: "redactedInputEnc" }, prompt.prompt),
      output: value as object,
      latencyMs: Date.now() - started,
      tokensIn: usage.inputTokens ?? null,
      tokensOut: usage.outputTokens ?? null,
    },
  });
  return { value, provider, model, cached: false };
}

const MODEL_TIMEOUT_MS = 20_000;
const withTimeout = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]) : AbortSignal.timeout(MODEL_TIMEOUT_MS));

export async function analyzeReference(meta: Omit<CallMeta, "purpose" | "promptVersion">, input: ReferenceDTO, signal?: AbortSignal) {
  const dto = ReferenceDTO.parse(input);
  let r;
  try {
    r = await call({ ...meta, purpose: "reference", promptVersion: REFERENCE_PROMPT_VERSION }, dto, ReferenceAnalysis, referencePrompt(dto), () => offlineAnalyzeReference(dto), withTimeout(signal));
  } catch (e) {
    if (signal?.aborted) throw e;
    // Model outage: score the text with the offline lexicon rather than stall the application.
    return { value: offlineAnalyzeReference(dto), provider: "offline", model: "lexicon-v1 (fallback)", cached: false, guardTripped: false, promptVersion: REFERENCE_PROMPT_VERSION, fallback: true };
  }
  // Output guard: evidence quotes are shown to staff, so they get the same scan as inputs.
  const tripped = r.value.evidenceQuotes.some(mentionsProtected);
  const value = tripped ? { ...r.value, evidenceQuotes: [] } : r.value;
  return { ...r, value, guardTripped: tripped, promptVersion: REFERENCE_PROMPT_VERSION, fallback: false };
}

export async function writeRationale(meta: Omit<CallMeta, "purpose" | "promptVersion">, input: RationaleDTO, signal?: AbortSignal) {
  const dto = RationaleDTO.parse(input);
  try {
    const r = await call({ ...meta, purpose: "rationale", promptVersion: RATIONALE_PROMPT_VERSION }, dto, Rationale, rationalePrompt(dto), () => templateRationale(dto), withTimeout(signal));
    if (mentionsProtected(r.value.summary)) return { summary: templateRationale(dto).summary, source: "TEMPLATE" as const, guardTripped: true, model: r.model };
    return { summary: r.value.summary, source: r.provider === "offline" ? ("TEMPLATE" as const) : ("LLM" as const), guardTripped: false, model: r.model };
  } catch (e) {
    if (signal?.aborted) throw e;
    // A model failure never blocks a decision: the rationale falls back to the template.
    return { summary: templateRationale(dto).summary, source: "TEMPLATE" as const, guardTripped: false, model: "template" };
  }
}

export async function triageTicket(meta: Omit<CallMeta, "purpose" | "promptVersion">, input: TriageDTO, signal?: AbortSignal) {
  const dto = TriageDTO.parse(input);
  try {
    const r = await call({ ...meta, purpose: "triage", promptVersion: TRIAGE_PROMPT_VERSION }, dto, TriageResult, triagePrompt(dto), () => offlineTriage(dto), withTimeout(signal));
    return { ...r.value, source: r.provider === "offline" ? ("OFFLINE" as const) : ("LLM" as const) };
  } catch {
    return { ...offlineTriage(dto), source: "OFFLINE" as const };
  }
}
