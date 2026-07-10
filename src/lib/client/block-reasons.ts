/**
 * Normalize block / gate messages into clear, user-facing labels.
 * Stocks / paper only — no crypto or live trading.
 */

export type BlockReasonKind =
  | "market_closed"
  | "execution_off"
  | "high_risk"
  | "stale_quote"
  | "wide_spread"
  | "hold"
  | "other";

const KIND_LABEL: Record<BlockReasonKind, string> = {
  market_closed: "Market closed",
  execution_off: "Order execution off",
  high_risk: "High risk",
  stale_quote: "Stale quote",
  wide_spread: "Wide spread",
  hold: "HOLD — not tradeable",
  other: "Blocked",
};

export function classifyBlockText(text: string): BlockReasonKind {
  const t = text.toLowerCase();
  if (/execution.?disabled|execution is off|order execution/i.test(t) && /off|disabled/i.test(t)) {
    return "execution_off";
  }
  if (/execution_disabled|enable_paper_order_execution/i.test(t)) {
    return "execution_off";
  }
  if (/market is closed|market closed|while.*closed/i.test(t)) {
    return "market_closed";
  }
  if (/stale quote|quote is stale|quote freshness/i.test(t)) {
    return "stale_quote";
  }
  if (/spread too wide|wide spread|spread is too wide/i.test(t)) {
    return "wide_spread";
  }
  if (/risk is high|high risk|risk status is high/i.test(t)) {
    return "high_risk";
  }
  if (/^hold\b|hold decisions|not tradeable/i.test(t)) {
    return "hold";
  }
  return "other";
}

export function formatBlockLabel(text: string): string {
  const kind = classifyBlockText(text);
  if (kind === "other") {
    // Keep original but trim noise
    return text.replace(/\s+/g, " ").trim();
  }
  return KIND_LABEL[kind];
}

/** Dedupe and prioritize clear block labels. */
export function uniqueBlockLabels(reasons: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of reasons) {
    const label = formatBlockLabel(r);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function blockTone(kind: BlockReasonKind): string {
  if (kind === "execution_off" || kind === "market_closed") {
    return "border-amber-500/50 bg-amber-500/15 text-amber-100";
  }
  if (kind === "high_risk" || kind === "wide_spread" || kind === "stale_quote") {
    return "border-rose-500/45 bg-rose-500/15 text-rose-100";
  }
  return "border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--muted)]";
}

/** Drop kinds already shown as page-level banners so rows stay compact. */
export function withoutGlobalBlockKinds(
  reasons: string[],
  opts: { marketClosed?: boolean; executionOff?: boolean },
): string[] {
  const exclude = new Set<BlockReasonKind>();
  if (opts.marketClosed) exclude.add("market_closed");
  if (opts.executionOff) exclude.add("execution_off");
  if (exclude.size === 0) return uniqueBlockLabels(reasons);
  return uniqueBlockLabels(reasons).filter(
    (label) => !exclude.has(classifyBlockText(label)),
  );
}

export function aiStatusDisplayLabel(
  statusLabel: "heuristic" | "connected" | "fallback" | string | null | undefined,
): string {
  if (statusLabel === "connected") return "AI: Ollama";
  return "AI fallback: heuristic";
}
