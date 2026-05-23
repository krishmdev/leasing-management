import { mockProvider } from "./mock";
import { smartMoveProvider } from "./smartmove.stub";
import type { ScreeningProvider } from "./types";

export function screeningProvider(id = process.env.SCREENING_PROVIDER ?? "mock"): ScreeningProvider {
  return id === "smartmove" ? smartMoveProvider : mockProvider;
}
