import type { RationaleDTO, ReferenceDTO, TriageDTO } from "../guardrails/dto";

export const REFERENCE_PROMPT_VERSION = "referenceAnalysis.v1";
export const RATIONALE_PROMPT_VERSION = "rationale.v1";
export const TRIAGE_PROMPT_VERSION = "triage.v1";

export function referencePrompt(dto: ReferenceDTO) {
  return {
    system:
      "You read landlord references for a rental application. Score only rental behavior: paying rent, caring for the unit, following the lease. " +
      "Ignore anything about who the tenant is. Text marked [REDACTED] was removed on purpose; don't guess at it. Quote evidence verbatim.",
    prompt: `Structured answers: ${JSON.stringify(dto.structured)}\nTenancy length: ${dto.tenancyMonths} months\nFree text from the landlord:\n"""${dto.redactedText}"""`,
  };
}

export function rationalePrompt(dto: RationaleDTO) {
  return {
    system:
      "You explain a rental screening result that has already been decided by a fixed rubric. Do not change or second-guess the outcome. " +
      "Write two to four plain sentences for the leasing agent. Mention only the factors listed. Never mention any personal characteristic.",
    prompt: JSON.stringify(dto),
  };
}

export function triagePrompt(dto: TriageDTO) {
  return {
    system:
      "Classify a residential maintenance request by category and urgency. EMERGENCY means risk to life or major property damage right now. " +
      "HIGH means a core function (water, heat in winter, a working toilet, a lock) is out. LOW means cosmetic.",
    prompt: `Month: ${dto.month}\nTitle: ${dto.title}\nDescription: ${dto.redactedText}`,
  };
}
