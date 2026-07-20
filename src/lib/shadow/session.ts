/**
 * Live shadow session manager (Milestone I-4).
 * Challenger never calls broker submission adapters.
 */

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { evaluateStrategyAt } from "@/lib/backtest/evaluator";
import { evaluateChallengerShadow } from "@/lib/backtest/shadow";
import {
  applyEntryCosts,
  defaultAssumptions,
  estimateSlippagePct,
  estimateSpreadPct,
} from "@/lib/backtest/costs";
import { alpacaToHistorical } from "@/lib/backtest/historical-data";
import { resolveSameCandleExit } from "@/lib/backtest/execution";
import { REGIME_FILTER_VERSION } from "@/lib/backtest/challenger-regime";
import { getChampionIdentity } from "@/lib/strategy/registry";
import type { AlpacaBar, AlpacaQuote } from "@/lib/alpaca/types";
import type { MarketRegime } from "@/lib/learning/regime";

const DIR = path.join(process.cwd(), "data", "shadow");
const STATE = path.join(DIR, "active-session.json");
const SESSIONS_DIR = path.join(DIR, "sessions");
const INDEX = path.join(DIR, "sessions-index.jsonl");

export type ShadowSessionStatus =
  | "RUNNING"
  | "COMPLETED"
  | "STOPPED"
  | "FAILED"
  | "INCOMPLETE";

export type ShadowValidity = "VALID" | "PARTIAL" | "INVALID";

export type ShadowScanRecord = {
  scanId: string;
  sessionId: string;
  timestamp: string;
  symbol: string;
  marketSnapshotId: string;
  dataQualityStatus: string;
  regime: MarketRegime | "unknown";
  champion: {
    version: string;
    action: string;
    confidence: number;
    rejectionReasons: string[];
    proposal: {
      entry: number | null;
      stopLoss: number | null;
      takeProfit: number | null;
    };
    /** Actual paper path may submit; recorded separately. */
    paperSubmitEligible: boolean;
  };
  challenger: {
    version: string;
    action: string;
    confidence: number;
    rejectionReasons: string[];
    proposal: {
      entry: number | null;
      stopLoss: number | null;
      takeProfit: number | null;
    };
    brokerSubmitAttempted: false;
    simulatedFill: number | null;
  };
};

export type ShadowSimTrade = {
  id: string;
  sessionId: string;
  symbol: string;
  strategyVersion: string;
  role: "challenger_simulated";
  entryTime: string;
  exitTime: string | null;
  fillEntry: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number | null;
  exitReason: string | null;
  qty: number;
  realizedPnl: number | null;
  open: boolean;
};

export type ShadowSession = {
  sessionId: string;
  status: ShadowSessionStatus;
  validity: ShadowValidity | null;
  startedAt: string;
  stoppedAt: string | null;
  championVersion: string;
  challengerVersion: string;
  blockedRegimes: string[];
  universe: string[];
  runtimeSettingsSnapshot: {
    executionEnabled: boolean;
    autoTradingEnabled: boolean;
    note: string;
  };
  executionAssumptions: ReturnType<typeof defaultAssumptions>;
  scansProcessed: number;
  championProposals: number;
  challengerProposals: number;
  matchingProposals: number;
  championOnly: number;
  challengerOnly: number;
  bothRejected: number;
  simulatedTrades: number;
  safetyViolations: number;
  dataQualityWarnings: string[];
  missingDataWarnings: string[];
  openSimPositions: number;
  scans: ShadowScanRecord[];
  simTrades: ShadowSimTrade[];
  review: ShadowSessionReview | null;
  paperOnly: true;
  liveTradingAllowed: false;
  challengerBrokerAccess: "blocked";
};

export type ShadowSessionReview = {
  sessionId: string;
  durationMs: number;
  dataCompleteness: string;
  eligibleSymbols: number;
  scans: number;
  proposalsChampion: number;
  proposalsChallenger: number;
  simulatedTrades: number;
  mainRejectionReasons: { reason: string; count: number }[];
  bestSymbols: string[];
  worstSymbols: string[];
  validity: ShadowValidity;
  validForEvidence: boolean;
  note: string;
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function writeJsonAtomic(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

async function persistSession(session: ShadowSession) {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeJsonAtomic(
    path.join(SESSIONS_DIR, `${session.sessionId}.json`),
    session,
  );
  if (session.status === "RUNNING") {
    await writeJsonAtomic(STATE, {
      sessionId: session.sessionId,
      status: session.status,
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function readShadowSession(
  sessionId: string,
): Promise<ShadowSession | null> {
  try {
    const raw = await readFile(
      path.join(SESSIONS_DIR, `${sessionId}.json`),
      "utf8",
    );
    return JSON.parse(raw) as ShadowSession;
  } catch {
    return null;
  }
}

export async function getActiveShadowSession(): Promise<ShadowSession | null> {
  try {
    const raw = await readFile(STATE, "utf8");
    const st = JSON.parse(raw) as { sessionId?: string };
    if (!st.sessionId) return null;
    return readShadowSession(st.sessionId);
  } catch {
    return null;
  }
}

/**
 * On process start: mark interrupted RUNNING sessions INCOMPLETE.
 */
export async function recoverInterruptedShadowSessions(): Promise<number> {
  let n = 0;
  try {
    const active = await getActiveShadowSession();
    if (active && active.status === "RUNNING") {
      active.status = "INCOMPLETE";
      active.stoppedAt = new Date().toISOString();
      active.validity = "INVALID";
      active.dataQualityWarnings.push(
        "Session interrupted by process restart — marked INCOMPLETE",
      );
      await persistSession(active);
      await writeJsonAtomic(STATE, { sessionId: null, status: null });
      await appendIndex(active);
      n += 1;
    }
  } catch {
    /* ignore */
  }
  return n;
}

async function appendIndex(session: ShadowSession) {
  await mkdir(DIR, { recursive: true });
  await writeFile(
    INDEX,
    `${JSON.stringify({
      sessionId: session.sessionId,
      status: session.status,
      validity: session.validity,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
      championVersion: session.championVersion,
      challengerVersion: session.challengerVersion,
      scans: session.scansProcessed,
      challengerProposals: session.challengerProposals,
    })}\n`,
    { flag: "a" },
  );
}

export async function listShadowSessions(limit = 50): Promise<
  {
    sessionId: string;
    status: string;
    validity: string | null;
    startedAt: string;
    stoppedAt: string | null;
    scans: number;
    challengerProposals: number;
  }[]
> {
  try {
    const raw = await readFile(INDEX, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

export async function startShadowSession(input?: {
  challengerVersion?: string;
  blockedRegimes?: string[];
  universe?: string[];
  executionEnabled?: boolean;
  autoTradingEnabled?: boolean;
}): Promise<ShadowSession> {
  await recoverInterruptedShadowSessions();
  const existing = await getActiveShadowSession();
  if (existing && existing.status === "RUNNING") {
    throw new Error(`Shadow session already running: ${existing.sessionId}`);
  }

  const champ = getChampionIdentity();
  const session: ShadowSession = {
    sessionId: newId("shsess"),
    status: "RUNNING",
    validity: null,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    championVersion: champ.version,
    challengerVersion: input?.challengerVersion ?? REGIME_FILTER_VERSION,
    blockedRegimes: input?.blockedRegimes ?? [
      "weak_uncertain",
      "high_volatility",
    ],
    universe: input?.universe ?? [],
    runtimeSettingsSnapshot: {
      executionEnabled: input?.executionEnabled ?? false,
      autoTradingEnabled: input?.autoTradingEnabled ?? false,
      note: "Starting shadow does not enable execution or auto trading",
    },
    executionAssumptions: defaultAssumptions(),
    scansProcessed: 0,
    championProposals: 0,
    challengerProposals: 0,
    matchingProposals: 0,
    championOnly: 0,
    challengerOnly: 0,
    bothRejected: 0,
    simulatedTrades: 0,
    safetyViolations: 0,
    dataQualityWarnings: [],
    missingDataWarnings: [],
    openSimPositions: 0,
    scans: [],
    simTrades: [],
    review: null,
    paperOnly: true,
    liveTradingAllowed: false,
    challengerBrokerAccess: "blocked",
  };
  await persistSession(session);
  return session;
}

export async function stopShadowSession(
  reason: "STOPPED" | "COMPLETED" | "FAILED" = "STOPPED",
): Promise<ShadowSession | null> {
  const session = await getActiveShadowSession();
  if (!session || session.status !== "RUNNING") return session;
  session.status = reason;
  session.stoppedAt = new Date().toISOString();
  // Close open sim positions at last known
  for (const t of session.simTrades) {
    if (t.open) {
      t.open = false;
      t.exitTime = session.stoppedAt;
      t.exitPrice = t.fillEntry;
      t.exitReason = "session_stop";
      t.realizedPnl = 0;
    }
  }
  session.openSimPositions = 0;
  session.review = buildSessionReview(session);
  session.validity = session.review.validity;
  await persistSession(session);
  await writeJsonAtomic(STATE, { sessionId: null, status: null });
  await appendIndex(session);
  return session;
}

function buildSessionReview(session: ShadowSession): ShadowSessionReview {
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.stoppedAt ?? new Date().toISOString());
  const durationMs = Math.max(0, end - start);
  const rejectCounts = new Map<string, number>();
  for (const s of session.scans) {
    for (const r of [
      ...s.champion.rejectionReasons,
      ...s.challenger.rejectionReasons,
    ]) {
      rejectCounts.set(r, (rejectCounts.get(r) ?? 0) + 1);
    }
  }
  const mainRejectionReasons = [...rejectCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));

  const bySym = new Map<string, number>();
  for (const t of session.simTrades) {
    if (t.realizedPnl != null) {
      bySym.set(t.symbol, (bySym.get(t.symbol) ?? 0) + t.realizedPnl);
    }
  }
  const sorted = [...bySym.entries()].sort((a, b) => b[1] - a[1]);
  const bestSymbols = sorted.slice(0, 3).map(([s]) => s);
  const worstSymbols = sorted.slice(-3).reverse().map(([s]) => s);

  let validity: ShadowValidity = "VALID";
  if (session.status === "INCOMPLETE" || session.status === "FAILED") {
    validity = "INVALID";
  } else if (
    session.scansProcessed < 5 ||
    session.missingDataWarnings.length > session.scansProcessed / 2
  ) {
    validity = "PARTIAL";
  }
  if (session.safetyViolations > 0) validity = "INVALID";

  return {
    sessionId: session.sessionId,
    durationMs,
    dataCompleteness:
      session.missingDataWarnings.length === 0 ? "complete" : "partial",
    eligibleSymbols: new Set(session.scans.map((s) => s.symbol)).size,
    scans: session.scansProcessed,
    proposalsChampion: session.championProposals,
    proposalsChallenger: session.challengerProposals,
    simulatedTrades: session.simTrades.filter((t) => !t.open).length,
    mainRejectionReasons,
    bestSymbols,
    worstSymbols,
    validity,
    validForEvidence: validity === "VALID",
    note: "Challenger results are simulated and did not submit broker orders. Actual paper champion P&L is separate.",
  };
}

/**
 * Process one shared market snapshot for champion + challenger.
 * Safe when execution/auto-trading are OFF.
 */
export async function processShadowScan(input: {
  scanId?: string;
  timestamp?: string;
  symbol: string;
  bars5Min: AlpacaBar[];
  quote?: AlpacaQuote | null;
  dataQualityStatus?: string;
  paperSubmitEligible?: boolean;
}): Promise<ShadowScanRecord | null> {
  const session = await getActiveShadowSession();
  if (!session || session.status !== "RUNNING") return null;

  const timestamp = input.timestamp ?? new Date().toISOString();
  const scanId = input.scanId ?? newId("scan");
  const symbol = input.symbol.toUpperCase();
  const marketSnapshotId = `snap_${symbol}_${Date.parse(timestamp).toString(36)}`;

  if (!input.bars5Min?.length) {
    session.missingDataWarnings.push(`${timestamp} ${symbol}: missing bars`);
    session.scansProcessed += 1;
    await persistSession(session);
    return null;
  }

  const champion = evaluateStrategyAt({
    decisionTime: timestamp,
    symbol,
    bars5Min: input.bars5Min,
    quote: input.quote,
    strategyVersion: session.championVersion,
  });

  const challenger = evaluateChallengerShadow({
    decisionTime: timestamp,
    symbol,
    bars5Min: input.bars5Min,
    quote: input.quote,
    blockedRegimes: session.blockedRegimes,
    strategyVersion: session.challengerVersion,
  });

  if (challenger.brokerSubmit !== false) {
    session.safetyViolations += 1;
  }

  const hist = alpacaToHistorical(symbol, input.bars5Min.slice(-40), "live_shadow");
  const last = hist.at(-1);
  const assumptions = session.executionAssumptions;
  const spreadPct = last
    ? estimateSpreadPct(last, hist, assumptions)
    : assumptions.fixedSpreadBps / 10_000;
  const slipPct = last
    ? estimateSlippagePct(last, hist, assumptions)
    : assumptions.fixedSlippageBps / 10_000;

  let simulatedFill: number | null = null;
  if (
    challenger.action === "BUY" &&
    challenger.proposedEntry != null &&
    challenger.stopLoss != null &&
    challenger.takeProfit != null
  ) {
    const costs = applyEntryCosts(
      challenger.proposedEntry,
      "buy",
      spreadPct,
      slipPct,
    );
    simulatedFill = costs.fill;
    const openCount = session.simTrades.filter((t) => t.open).length;
    const already = session.simTrades.some(
      (t) => t.open && t.symbol === symbol,
    );
    if (!already && openCount < 3) {
      session.simTrades.push({
        id: newId("sim"),
        sessionId: session.sessionId,
        symbol,
        strategyVersion: session.challengerVersion,
        role: "challenger_simulated",
        entryTime: timestamp,
        exitTime: null,
        fillEntry: costs.fill,
        stopLoss: challenger.stopLoss,
        takeProfit: challenger.takeProfit,
        exitPrice: null,
        exitReason: null,
        qty: Math.max(1, Math.floor(challenger.risk?.qty ?? 1)),
        realizedPnl: null,
        open: true,
      });
    }
  }

  // Manage open sim exits on this bar
  if (last) {
    for (const t of session.simTrades) {
      if (!t.open || t.symbol !== symbol) continue;
      const resolved = resolveSameCandleExit({
        stop: t.stopLoss,
        target: t.takeProfit,
        low: last.low,
        high: last.high,
        close: last.close,
        isLastBar: false,
        stopFirst: true,
      });
      if (resolved.exitPrice != null) {
        const exitFill = resolved.exitPrice * (1 - slipPct);
        t.open = false;
        t.exitTime = timestamp;
        t.exitPrice = exitFill;
        t.exitReason = resolved.exitReason;
        t.realizedPnl = (exitFill - t.fillEntry) * t.qty;
        session.simulatedTrades += 1;
      }
    }
  }

  const record: ShadowScanRecord = {
    scanId,
    sessionId: session.sessionId,
    timestamp,
    symbol,
    marketSnapshotId,
    dataQualityStatus: input.dataQualityStatus ?? "unknown",
    regime: champion.regime,
    champion: {
      version: session.championVersion,
      action: champion.action,
      confidence: champion.confidence,
      rejectionReasons: champion.rejectionReasons,
      proposal: {
        entry: champion.proposedEntry,
        stopLoss: champion.stopLoss,
        takeProfit: champion.takeProfit,
      },
      paperSubmitEligible: input.paperSubmitEligible ?? false,
    },
    challenger: {
      version: session.challengerVersion,
      action: challenger.action,
      confidence: challenger.confidence,
      rejectionReasons: challenger.rejectionReasons,
      proposal: {
        entry: challenger.proposedEntry,
        stopLoss: challenger.stopLoss,
        takeProfit: challenger.takeProfit,
      },
      brokerSubmitAttempted: false,
      simulatedFill,
    },
  };

  const champBuy = champion.action === "BUY";
  const challBuy = challenger.action === "BUY";
  if (champBuy) session.championProposals += 1;
  if (challBuy) session.challengerProposals += 1;
  if (champBuy && challBuy) session.matchingProposals += 1;
  else if (champBuy) session.championOnly += 1;
  else if (challBuy) session.challengerOnly += 1;
  else session.bothRejected += 1;

  if (!session.universe.includes(symbol)) session.universe.push(symbol);
  session.scansProcessed += 1;
  session.openSimPositions = session.simTrades.filter((t) => t.open).length;
  // Cap in-memory scan history
  session.scans.push(record);
  if (session.scans.length > 2000) {
    session.scans = session.scans.slice(-1500);
  }
  await persistSession(session);
  return record;
}

export function summarizeEvidenceProgress(sessions: ShadowSession[]): {
  validSessions: number;
  targetSessions: number;
  challengerProposals: number;
  targetProposals: number;
  safetyViolations: number;
  incompleteSessions: number;
  regimesSeen: string[];
  note: string;
} {
  const valid = sessions.filter(
    (s) => s.validity === "VALID" && s.review?.validForEvidence,
  );
  const proposals = valid.reduce((a, s) => a + s.challengerProposals, 0);
  const regimes = new Set<string>();
  for (const s of valid) {
    for (const sc of s.scans) regimes.add(sc.regime);
  }
  return {
    validSessions: valid.length,
    targetSessions: 10,
    challengerProposals: proposals,
    targetProposals: 30,
    safetyViolations: sessions.reduce((a, s) => a + s.safetyViolations, 0),
    incompleteSessions: sessions.filter(
      (s) => s.status === "INCOMPLETE" || s.validity === "INVALID",
    ).length,
    regimesSeen: [...regimes],
    note: "Only VALID sessions count toward evidence. Promotion remains disabled.",
  };
}
