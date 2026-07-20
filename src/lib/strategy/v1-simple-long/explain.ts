/**
 * Plain-English explanations for V1 strategy results.
 * Deterministic fallback always works. Optional Ollama may only summarize —
 * it must never change the locked decision, score, or risk levels.
 */

import type { V1StrategyResult } from "@/lib/strategy/v1-simple-long/types";

export function buildV1FallbackExplanation(
  result: Omit<V1StrategyResult, "explanation">,
): string {
  const failed = result.conditions
    .filter((c) => !c.passed && c.mandatory)
    .map((c) => c.name);
  const passedTech = result.conditions
    .filter(
      (c) =>
        c.passed && ["trend", "momentum", "volume"].includes(c.category),
    )
    .map((c) => c.name);

  if (result.decision === "BUY") {
    return `BUY candidate for ${result.symbol}: score ${(result.score * 100).toFixed(0)}% (threshold ${(result.buyThreshold * 100).toFixed(0)}%). ${passedTech.slice(0, 3).join("; ") || "Technical conditions passed"}. Suggested entry $${result.suggestedEntry?.toFixed(2) ?? "—"}, stop $${result.suggestedStopLoss?.toFixed(2) ?? "—"}, target $${result.suggestedTakeProfit?.toFixed(2) ?? "—"}. Planning only — no order submitted.`;
  }
  if (result.decision === "WATCH") {
    return `WATCH ${result.symbol}: setup is promising (score ${(result.score * 100).toFixed(0)}%) but not ready. Missing: ${failed.slice(0, 3).join("; ") || "stronger confirmation"}.`;
  }
  if (result.decision === "SKIP") {
    return `SKIP ${result.symbol}: blocked this scan. ${failed.slice(0, 3).join("; ") || result.blockReasons[0] || "Safety or data block"}.`;
  }
  return `HOLD ${result.symbol}: no Version 1 long entry. Score ${(result.score * 100).toFixed(0)}%.`;
}

/**
 * Attach explanation without mutating decision fields.
 * Ollama failure → keep deterministic fallback.
 */
export async function explainV1StrategyResult(
  result: V1StrategyResult,
): Promise<V1StrategyResult> {
  const fallback = buildV1FallbackExplanation(result);
  try {
    const { getAiProviderName } = await import("@/lib/ai/provider");
    if (getAiProviderName() !== "ollama") {
      return { ...result, explanation: fallback };
    }
    // Reuse trade-reasoning style: never override locked decision.
    // Keep implementation local/fallback-first for reliability in V1-3.
    return { ...result, explanation: fallback };
  } catch {
    return { ...result, explanation: fallback };
  }
}

/** Pure helper used by tests: LLM cannot change a locked decision object. */
export function applyLlmExplanationSafely(
  result: V1StrategyResult,
  llmText: string | null | undefined,
): V1StrategyResult {
  const fallback = buildV1FallbackExplanation(result);
  if (!llmText?.trim()) {
    return { ...result, explanation: fallback };
  }
  // Never allow explanation path to mutate decision/score/levels
  return {
    ...result,
    decision: result.decision,
    score: result.score,
    suggestedEntry: result.suggestedEntry,
    suggestedStopLoss: result.suggestedStopLoss,
    suggestedTakeProfit: result.suggestedTakeProfit,
    explanation: llmText.trim(),
  };
}
