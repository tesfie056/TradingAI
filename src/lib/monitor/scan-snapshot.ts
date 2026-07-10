/**
 * Last-scan snapshot: every watchlist symbol with scores and auto eligibility.
 * Paper only — never places orders.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiDecision } from "@/lib/alpaca/types";
import type { AutoTradeDecision, AutoTradeSkipCode } from "@/lib/auto-trade/types";
import { suggestMonitorAction } from "@/lib/monitor/opportunity";
import type { MonitorSuggestedAction } from "@/lib/monitor/types";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "last-scan-snapshot.json");

export type ScannedSymbolSignal =
  | "BUY"
  | "SELL"
  | "HOLD"
  | "WATCH"
  | "SKIP";

export type ScannedSymbolResult = {
  rank: number;
  symbol: string;
  signal: ScannedSymbolSignal;
  confidence: number;
  finalScore: number;
  technicalScore: number;
  newsScore: number;
  marketScore: number;
  riskScore: number;
  autoEligible: boolean;
  skippedReason: string | null;
  skipCode: AutoTradeSkipCode | null;
  orderSubmitted: boolean;
  lastScannedAt: string;
  paperOnly: true;
};

export type LastScanSnapshot = {
  scannedAt: string;
  symbols: string[];
  stocksScanned: number;
  ranked: ScannedSymbolResult[];
  topSymbol: string | null;
  topAction: ScannedSymbolSignal | null;
  paperOnly: true;
};

function toSignal(decision: AiDecision): ScannedSymbolSignal {
  if (decision.decisionLabel) return decision.decisionLabel;
  const suggested = suggestMonitorAction(decision);
  if (suggested === "BUY" || suggested === "SELL" || suggested === "WATCH") {
    return suggested;
  }
  return "HOLD";
}

function rankKey(row: ScannedSymbolResult): number {
  // Prefer actionable signals, then higher confidence / final score.
  const actionBoost =
    row.signal === "BUY" || row.signal === "SELL"
      ? 2
      : row.signal === "WATCH"
        ? 1
        : 0;
  return actionBoost * 10 + row.confidence + row.finalScore;
}

/**
 * Build ranked scan rows for every watchlist decision.
 * Auto eligibility comes from auto-trade decisions when present.
 */
export function buildScannedSymbolResults(input: {
  decisions: AiDecision[];
  autoDecisions?: AutoTradeDecision[];
  scannedAt: string;
}): ScannedSymbolResult[] {
  const autoBySymbol = new Map<string, AutoTradeDecision>();
  for (const d of input.autoDecisions ?? []) {
    const key = d.symbol.toUpperCase();
    const existing = autoBySymbol.get(key);
    if (!existing) {
      autoBySymbol.set(key, d);
      continue;
    }
    // Prefer submitted/filled over skipped when multiple.
    const rank = (s: AutoTradeDecision["status"]) =>
      s === "filled" || s === "submitted" ? 2 : s === "pending" ? 1 : 0;
    if (rank(d.status) >= rank(existing.status)) autoBySymbol.set(key, d);
  }

  const rows: ScannedSymbolResult[] = input.decisions.map((decision) => {
    const symbol = decision.symbol.toUpperCase();
    const signal = toSignal(decision);
    const auto = autoBySymbol.get(symbol);
    const scores = decision.scores;
    let autoEligible = false;
    let skippedReason: string | null = null;
    let skipCode: AutoTradeSkipCode | null = null;
    let orderSubmitted = false;

    if (auto) {
      orderSubmitted =
        auto.status === "submitted" || auto.status === "filled";
      autoEligible = orderSubmitted || auto.status === "pending";
      if (auto.status === "skipped" || auto.status === "rejected") {
        autoEligible = false;
        const primary = auto.blockers[0];
        skipCode = primary?.code ?? null;
        skippedReason =
          primary?.message ??
          (auto.blockers.length
            ? auto.blockers.map((b) => b.message).join(" · ")
            : "Skipped");
      }
    } else if (signal === "BUY" || signal === "SELL") {
      autoEligible = false;
      skippedReason =
        decision.tradeBlockReasons?.[0] ??
        "Not processed for auto trade this scan";
    } else if (signal === "WATCH") {
      autoEligible = false;
      skippedReason = "WATCH — not auto-traded";
      skipCode = "watch_action";
    } else if (signal === "SKIP") {
      autoEligible = false;
      skippedReason =
        decision.tradeBlockReasons?.[0] ?? "SKIP — safety/quality filter";
    } else {
      autoEligible = false;
      skippedReason = "HOLD — no trade signal";
      skipCode = "hold_action";
    }

    return {
      rank: 0,
      symbol,
      signal,
      confidence: Number((decision.confidence ?? 0).toFixed(3)),
      finalScore: Number((scores?.finalScore ?? 0.5).toFixed(3)),
      technicalScore: Number((scores?.technicalScore ?? 0.5).toFixed(3)),
      newsScore: Number((scores?.newsScore ?? 0.5).toFixed(3)),
      marketScore: Number((scores?.marketScore ?? 0.5).toFixed(3)),
      riskScore: Number((scores?.riskScore ?? 0.5).toFixed(3)),
      autoEligible,
      skippedReason,
      skipCode,
      orderSubmitted,
      lastScannedAt: input.scannedAt,
      paperOnly: true,
    };
  });

  rows.sort((a, b) => rankKey(b) - rankKey(a));
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildLastScanSnapshot(input: {
  symbols: string[];
  decisions: AiDecision[];
  autoDecisions?: AutoTradeDecision[];
  scannedAt: string;
}): LastScanSnapshot {
  const ranked = buildScannedSymbolResults(input);
  const top = ranked[0] ?? null;
  return {
    scannedAt: input.scannedAt,
    symbols: input.symbols.map((s) => s.toUpperCase()),
    stocksScanned: input.symbols.length,
    ranked,
    topSymbol: top?.symbol ?? null,
    topAction: top?.signal ?? null,
    paperOnly: true,
  };
}

export async function saveLastScanSnapshot(
  snapshot: LastScanSnapshot,
): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function readLastScanSnapshot(): Promise<LastScanSnapshot | null> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as LastScanSnapshot;
    if (parsed?.paperOnly !== true || !Array.isArray(parsed.ranked)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Format top-signal label so it never implies a single-symbol scan. */
export function formatTopSignalLabel(snapshot: LastScanSnapshot | null): string {
  if (!snapshot || snapshot.stocksScanned <= 0) {
    return "No scan yet";
  }
  const n = snapshot.stocksScanned;
  if (!snapshot.topSymbol || !snapshot.topAction) {
    return `No top signal from ${n} scanned symbol${n === 1 ? "" : "s"}`;
  }
  return `Top signal from ${n} scanned symbols: ${snapshot.topSymbol} · ${snapshot.topAction}`;
}

export function monitorActionFromSignal(
  signal: ScannedSymbolSignal,
): MonitorSuggestedAction {
  if (signal === "BUY" || signal === "SELL" || signal === "WATCH") return signal;
  return "HOLD";
}
