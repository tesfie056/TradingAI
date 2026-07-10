import type { NewsImportance, NewsSentiment } from "@/lib/news/types";

const POSITIVE = [
  "beat",
  "beats",
  "surge",
  "surges",
  "rally",
  "rallies",
  "gain",
  "gains",
  "growth",
  "record",
  "upgrade",
  "upgraded",
  "bullish",
  "profit",
  "profits",
  "strong",
  "outperform",
  "raises",
  "raised",
  "approval",
  "approved",
  "partnership",
  "expand",
  "expansion",
  "breakthrough",
  "optimistic",
  "soar",
  "soars",
  "jump",
  "jumps",
];

const NEGATIVE = [
  "miss",
  "misses",
  "fall",
  "falls",
  "drop",
  "drops",
  "decline",
  "declines",
  "cut",
  "cuts",
  "downgrade",
  "downgraded",
  "bearish",
  "loss",
  "losses",
  "weak",
  "lawsuit",
  "probe",
  "investigation",
  "recall",
  "layoff",
  "layoffs",
  "fraud",
  "warning",
  "plunge",
  "plunges",
  "slump",
  "slumps",
  "crash",
  "ban",
  "fine",
  "fined",
  "delay",
  "delays",
];

const HIGH_IMPORTANCE = [
  "earnings",
  "guidance",
  "fda",
  "merger",
  "acquisition",
  "acquire",
  "sec",
  "lawsuit",
  "bankruptcy",
  "split",
  "dividend",
  "ceo",
  "cfo",
  "antitrust",
  "tariff",
  "sanction",
];

/**
 * Simple local keyword sentiment — no paid AI.
 */
export function scoreHeadlineSentiment(
  headline: string,
  summary: string,
): { sentiment: NewsSentiment; importance: NewsImportance; score: number } {
  const text = `${headline} ${summary}`.toLowerCase();
  let score = 0;

  for (const w of POSITIVE) {
    if (text.includes(w)) score += 1;
  }
  for (const w of NEGATIVE) {
    if (text.includes(w)) score -= 1;
  }

  let sentiment: NewsSentiment = "neutral";
  if (score >= 1) sentiment = "positive";
  else if (score <= -1) sentiment = "negative";

  let importance: NewsImportance = "low";
  const hits = HIGH_IMPORTANCE.filter((w) => text.includes(w)).length;
  if (hits >= 2 || Math.abs(score) >= 3) importance = "high";
  else if (hits >= 1 || Math.abs(score) >= 1) importance = "medium";

  return { sentiment, importance, score };
}

export function impactFromSentiment(
  sentiment: NewsSentiment,
  importance: NewsImportance,
): string {
  if (sentiment === "positive") {
    return importance === "high"
      ? "Potentially supportive near-term narrative if confirmed by price action."
      : "Mildly constructive headline tone; treat as decision support only.";
  }
  if (sentiment === "negative") {
    return importance === "high"
      ? "Elevated downside narrative risk; prefer caution until market data confirms."
      : "Slightly negative tone; may temper confidence without forcing a trade.";
  }
  return "Neutral headline tone — limited directional implication on its own.";
}
