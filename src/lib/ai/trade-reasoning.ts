/**
 * Phase 12 — Ollama trade reasoning (read-only). Never places orders.
 */

import { getAiProviderName, getOllamaConfig } from "@/lib/ai/provider";
import type { AiDecision } from "@/lib/alpaca/types";
import type { AutoTradeBlocker } from "@/lib/auto-trade/types";

export type TradeReasoningInput = {
  decision: AiDecision;
  blockers?: AutoTradeBlocker[];
  placed?: boolean;
  previousSummary?: string | null;
};

export type TradeReasoningResult = {
  provider: "ollama" | "heuristic";
  summary: string;
  strength: string;
  weakness: string;
  allowBlock: string;
  risk: string;
  changedSinceLastScan: string;
  watchNext: string;
};

function heuristicReasoning(input: TradeReasoningInput): TradeReasoningResult {
  const d = input.decision;
  const label = d.decisionLabel ?? d.action;
  const blockers = input.blockers ?? [];
  const placed = input.placed ?? false;
  const scores = d.scores;
  const strength =
    scores && scores.finalScore >= 0.58
      ? `Final score ${scores.finalScore.toFixed(2)} with momentum ${scores.momentumScore?.toFixed(2) ?? "n/a"}.`
      : "Signal is mixed — no strong edge.";
  const weakness =
    blockers.length > 0
      ? blockers.map((b) => b.message).join(" ")
      : d.tradeBlockReasons?.join(" ") ?? "No major weakness flagged.";
  const allowBlock = placed
    ? "All safety checks passed — paper order allowed."
    : blockers.length > 0
      ? `Blocked: ${blockers.map((b) => b.code).join(", ")}.`
      : label === "HOLD" || label === "WATCH"
        ? "No trade — signal not decisive or not ready."
        : "Not submitted.";
  const risk = d.riskWarnings?.slice(0, 3).join(" ") || "Risk within normal bounds.";
  const changed =
    input.previousSummary && input.previousSummary !== d.explanation?.summary
      ? `Prior: ${input.previousSummary.slice(0, 120)} → Now: ${(d.explanation?.summary ?? "").slice(0, 120)}`
      : "First scan or unchanged summary.";
  const watchNext =
    label === "WATCH"
      ? "Watch for spread tightening and volume confirmation."
      : label === "BUY"
        ? "Watch for follow-through above VWAP and hold above support."
        : "Monitor next scan for score shift.";

  return {
    provider: "heuristic",
    summary: d.explanation?.summary ?? `${label} for ${d.symbol}.`,
    strength,
    weakness,
    allowBlock,
    risk,
    changedSinceLastScan: changed,
    watchNext,
  };
}

/**
 * Explain a trade decision with Ollama when configured; always safe (no orders).
 */
export async function explainTradeDecision(
  input: TradeReasoningInput,
): Promise<TradeReasoningResult> {
  const fallback = heuristicReasoning(input);
  if (getAiProviderName() !== "ollama") return fallback;

  const { baseUrl, model, timeoutMs } = getOllamaConfig();
  const d = input.decision;
  const prompt = [
    "You explain U.S. stock PAPER trading signals. Never recommend live trading.",
    "Respond with JSON only:",
    '{"summary":"","strength":"","weakness":"","allowBlock":"","risk":"","changedSinceLastScan":"","watchNext":""}',
    `Symbol: ${d.symbol}`,
    `Label: ${d.decisionLabel ?? d.action}`,
    `Confidence: ${d.confidence}`,
    `Scores: ${JSON.stringify(d.scores ?? {})}`,
    `Blockers: ${JSON.stringify((input.blockers ?? []).map((b) => b.code))}`,
    `Placed: ${input.placed ?? false}`,
    `Reasons: ${d.reasons?.slice(0, 3).join(" | ") ?? ""}`,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 25_000));

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
      }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { response?: string };
    const parsed = JSON.parse(data.response ?? "{}") as Partial<TradeReasoningResult>;
    return {
      provider: "ollama",
      summary: parsed.summary ?? fallback.summary,
      strength: parsed.strength ?? fallback.strength,
      weakness: parsed.weakness ?? fallback.weakness,
      allowBlock: parsed.allowBlock ?? fallback.allowBlock,
      risk: parsed.risk ?? fallback.risk,
      changedSinceLastScan:
        parsed.changedSinceLastScan ?? fallback.changedSinceLastScan,
      watchNext: parsed.watchNext ?? fallback.watchNext,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
