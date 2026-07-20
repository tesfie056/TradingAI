"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { Panel } from "@/components/ui/Panel";
import { fetchJson } from "@/lib/client/fetch-json";

type BreakdownRow = { trades: number; pnl: number; winRate?: number | null };

type RegimeCoverageRow = {
  regime: string;
  trades: number;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  avgHoldingBars: number | null;
  pnl: number;
  insufficientSample: boolean;
  sampleWarning: string | null;
};

type BacktestBlock = {
  id: string;
  kind: string;
  label?: string;
  realDataOnly?: boolean;
  syntheticDataUsed?: boolean;
  strategyVersion: string;
  periodStart: string;
  periodEnd: string;
  datasetId: string;
  symbols: string[];
  timeframe: string;
  assumptions: {
    spreadModel: string;
    slippageModel: string;
    fixedSpreadBps: number;
    fixedSlippageBps: number;
    notes: string[];
  };
  dataQuality: {
    warnings: { code: string; message: string }[];
    blocking: { code: string; message: string }[];
    passed: boolean;
  };
  dataQualityStatus?: string;
  coveragePercentage?: number | null;
  excludedSymbols?: { symbol: string; reason: string }[];
  sourceBySymbol?: Record<string, string>;
  metrics: {
    totalTrades: number;
    winRate: number | null;
    avgWinner: number | null;
    avgLoser: number | null;
    expectancy: number | null;
    profitFactor: number | null;
    totalReturn: number;
    maxDrawdown: number | null;
    sharpe: number | null;
    sortino: number | null;
    calmar: number | null;
    exposure: number | null;
    turnover: number | null;
    avgHoldingBars: number | null;
    consecutiveLosses: number;
    spreadCostTotal: number;
    slippageCostTotal: number;
    totalReturnBeforeCosts: number;
    totalReturnAfterCosts: number;
    bySymbol: Record<string, BreakdownRow>;
    byRegime: Record<string, BreakdownRow>;
    byMonth: Record<string, BreakdownRow>;
    byHourEt: Record<string, BreakdownRow>;
    byConfidence: Record<string, BreakdownRow>;
    statisticallyWeak: boolean;
    weakReason: string | null;
  };
  split: {
    training: { start: string; end: string };
    validation: { start: string; end: string };
    outOfSample: { start: string; end: string } | null;
    outOfSampleLocked: boolean;
    purgeGapDays: number;
  } | null;
  folds: {
    foldIndex: number;
    trainingStart: string;
    trainingEnd: string;
    validationStart: string;
    validationEnd: string;
    trades: number;
    totalReturn: number;
    expectancy: number | null;
    maxDrawdown: number | null;
    passed: boolean;
    failReason: string | null;
  }[];
  walkForward: {
    totalFolds: number;
    passingFolds: number;
    failingFolds: number;
    bestFold: { foldIndex: number; totalReturn: number } | null;
    worstFold: { foldIndex: number; totalReturn: number } | null;
    medianFoldReturn: number | null;
    pctProfitableFolds: number | null;
    pctAcceptableDrawdown: number | null;
    performanceDecayHint: string;
    parameterStabilityHint: string;
  } | null;
  regimes?: RegimeCoverageRow[];
  promotion: {
    checks: { id: string; label: string; passed: boolean; detail: string }[];
    eligible: boolean;
    promotionEnabled: false;
    manualApprovalRequired: true;
  } | null;
  promotionEnabled: false;
  disclaimer: string;
  runFingerprint?: {
    hash: string;
    strategyVersion: string;
    datasetId: string;
    spreadValue: number;
    slippageValue: number;
    evalStep?: number | null;
  } | null;
  comparableNote?: string | null;
  createdAt?: string;
};

type SymbolCoverageRow = {
  symbol: string;
  timeframe: string;
  earliest: string | null;
  latest: string | null;
  expectedCandles: number | null;
  actualCandles: number;
  coveragePercentage: number | null;
  missingSessions: number;
  duplicateCount: number;
  warnings: string[];
  dataSource: string;
  adjustmentStatus: string;
  lastRefresh: string | null;
  status: "READY" | "PARTIAL" | "BLOCKED" | "STALE";
  cacheFile: string;
};

type EvidenceItem = {
  id: string;
  category: "historical" | "shadow";
  label: string;
  passed: boolean;
  detail: string;
};

type EvidenceChecklist = {
  historical: EvidenceItem[];
  shadow: EvidenceItem[];
  failed: EvidenceItem[];
  sufficientForPromotionReview: false;
  promotionEnabled: false;
  syntheticCannotSatisfy: true;
  note: string;
};

type ShadowSummary = {
  sessionsCompleted: number;
  championProposals: number;
  challengerProposals: number;
  matchingProposals: number;
  championOnly: number;
  challengerOnly: number;
  simulatedTrades: number;
  safetyViolations: number;
  byRegime: Record<string, number>;
  note: string;
  challengerCannotTrade?: boolean;
};

type ChallengerInfo = {
  name: string;
  version: string;
  status: string;
  parentVersion: string | null;
  entryRules: string;
  parameterValues: Record<string, number | string | boolean | string[]>;
};

type StrategyComparison = {
  datasetId: string;
  periodStart: string;
  periodEnd: string;
  symbols: string[];
  champion: {
    version: string;
    trades: number;
    expectancy: number | null;
    profitFactor: number | null;
    maxDrawdown: number | null;
    sharpe: number | null;
    sortino: number | null;
    totalReturnAfterCosts: number;
    symbolConcentration: Record<string, number>;
  };
  challenger: {
    version: string;
    trades: number;
    expectancy: number | null;
    profitFactor: number | null;
    maxDrawdown: number | null;
    sharpe: number | null;
    sortino: number | null;
    totalReturnAfterCosts: number;
    symbolConcentration: Record<string, number>;
  };
  deltas: {
    trades: number;
    expectancy: number | null;
    profitFactor: number | null;
    maxDrawdown: number | null;
    totalReturnAfterCosts: number;
  };
  monthlyConsistency: {
    championWinningMonths: number;
    challengerWinningMonths: number;
    championLosingMonths: number;
    challengerLosingMonths: number;
  };
  regimeNotes: string[];
  oosDecayHint: string;
  disclaimer: string;
};

type StressRow = {
  id: string;
  label: string;
  trades: number;
  expectancy: number | null;
  profitFactor: number | null;
  totalReturnAfterCosts: number;
  fragileHint: string | null;
};

type LabPayload = {
  baseline: {
    champion: {
      strategyId: string;
      name: string;
      version: string;
      status: string;
      activeSince: string;
    };
    dataset: {
      eventCount: number;
      snapshotCount: number;
      reviewCount: number;
    };
    performance: {
      totalPaperTrades: number;
      winRate: number | null;
      profitFactor: number | null;
      expectancy: number | null;
      maxDrawdownHint: number | null;
      avgWinner: number | null;
      avgLoser: number | null;
      autoTradePnL: number;
    };
    regimes: { regime: string; label: string; count: number }[];
    reviews: Record<string, number>;
    session: { date: string | null; trades: number | null; note: string };
  };
  experiments: {
    strategyId: string;
    name: string;
    version: string;
    status: string;
    createdAt: string;
    parentVersion: string | null;
    rejectionReason: string | null;
  }[];
  analytics: {
    winRate: number | null;
    placed: number;
    skipped: number;
    autoTradePnL: number;
    bestSymbols: { symbol: string; trades: number; winRate: number | null }[];
    worstSymbols: { symbol: string; trades: number; winRate: number | null }[];
    confidenceVsResult: {
      range: string;
      count: number;
      accuracy: number | null;
    }[];
    timeOfDay: { hourEt: number; trades: number; avgPnl: number | null }[];
  };
  recentReviews: {
    id: string;
    symbol: string;
    classification: string;
    primaryReason: string;
    realizedPnl: number | null;
    regime: string | null;
    reviewedAt: string;
  }[];
  coverage?: {
    rows: SymbolCoverageRow[];
    ready: number;
    total: number;
  };
  backtest: BacktestBlock | null;
  challenger?: ChallengerInfo | null;
  shadow?: ShadowSummary | null;
  evidence?: EvidenceChecklist | null;
  liveShadow?: {
    active: {
      sessionId: string;
      status: string;
      startedAt: string;
      championVersion: string;
      challengerVersion: string;
      scansProcessed: number;
      championProposals: number;
      challengerProposals: number;
      openSimPositions: number;
      missingDataWarnings: string[];
    } | null;
    sessions: {
      sessionId: string;
      status: string;
      validity: string | null;
      startedAt: string;
      scans: number;
      challengerProposals: number;
    }[];
    evidence: {
      validSessions: number;
      targetSessions: number;
      challengerProposals: number;
      targetProposals: number;
      safetyViolations: number;
      incompleteSessions: number;
      regimesSeen: string[];
      note: string;
    };
  };
  weakness?: {
    findings: {
      id: string;
      category: string;
      label: string;
      sampleSize: number;
      expectancy: number | null;
      profitFactor: number | null;
      enoughEvidence: boolean;
      detail: string;
    }[];
    actionableFindings: {
      id: string;
      label: string;
      sampleSize: number;
      detail: string;
    }[];
    note: string;
  } | null;
  typedExperiments?: {
    id: string;
    kind: string;
    name: string;
    version: string;
    status: string;
    acceptance: {
      hypothesis: string;
      changedParameters: Record<string, unknown>;
      expectedBenefit: string;
      mainRisk: string;
    };
  }[];
};

type RunMode = "baseline" | "real_baseline" | "compare" | null;

type BackgroundJobPoll = {
  status: string;
  progress: number;
  message: string;
  result: unknown;
  error: string | null;
};

const EXPERIMENT_KINDS = [
  { kind: "cost_aware_filter", label: "Cost-aware filter" },
  { kind: "confidence_threshold", label: "Confidence threshold" },
  { kind: "time_of_day_filter", label: "Time-of-day filter" },
] as const;

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function BreakdownList({
  title,
  rows,
}: {
  title: string;
  rows: [string, BreakdownRow][];
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No data</p>
      ) : (
        <ul className="space-y-1 text-sm text-zinc-300">
          {rows.slice(0, 8).map(([k, v]) => (
            <li key={k} className="flex justify-between gap-2">
              <span>{k}</span>
              <span className="font-mono text-zinc-100">
                {v.trades} · {fmtNum(v.pnl)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BacktestMetricsGrid({ bt }: { bt: BacktestBlock }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Trades" value={String(bt.metrics.totalTrades)} />
      <Metric label="Win rate" value={fmtPct(bt.metrics.winRate)} />
      <Metric label="Expectancy" value={fmtNum(bt.metrics.expectancy)} />
      <Metric label="Profit factor" value={fmtNum(bt.metrics.profitFactor)} />
      <Metric
        label="Total return ($)"
        value={fmtNum(bt.metrics.totalReturn)}
      />
      <Metric label="Max drawdown" value={fmtPct(bt.metrics.maxDrawdown)} />
      <Metric label="Sharpe" value={fmtNum(bt.metrics.sharpe)} />
      <Metric label="Sortino" value={fmtNum(bt.metrics.sortino)} />
      <Metric label="Calmar" value={fmtNum(bt.metrics.calmar)} />
      <Metric
        label="Spread cost"
        value={fmtNum(bt.metrics.spreadCostTotal)}
      />
      <Metric
        label="Slippage cost"
        value={fmtNum(bt.metrics.slippageCostTotal)}
      />
      <Metric
        label="Return before costs"
        value={fmtNum(bt.metrics.totalReturnBeforeCosts)}
      />
    </div>
  );
}

function EvidenceList({
  title,
  items,
  passedTone,
}: {
  title: string;
  items: EvidenceItem[];
  passedTone: "pass" | "fail";
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-600">None</p>
      ) : (
        <ul className="space-y-1 text-sm text-zinc-300">
          {items.map((item) => (
            <li key={item.id}>
              <span
                className={
                  passedTone === "pass" ? "text-emerald-300" : "text-amber-200"
                }
              >
                {item.label}
              </span>{" "}
              <span className="text-zinc-500">({item.detail})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StrategyLabView() {
  const [data, setData] = useState<LabPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<RunMode>(null);
  const [stressResults, setStressResults] = useState<StressRow[] | null>(null);
  const [comparison, setComparison] = useState<StrategyComparison | null>(null);
  const [jobBusy, setJobBusy] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [reconcileNote, setReconcileNote] = useState<string | null>(null);
  const [shadowBusy, setShadowBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchJson<LabPayload & { ok?: boolean; error?: string }>(
        "/api/learning/summary",
      );
      setData(res);
      setError(res.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Strategy Lab");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      void refresh().finally(() => {
        if (cancelled) return;
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [refresh]);

  const runAction = useCallback(
    async (mode: "baseline" | "real_baseline" | "compare") => {
      setRunning(mode);
      try {
        const body =
          mode === "baseline"
            ? { mode: "baseline", useSynthetic: true, persist: true }
            : { mode, realDataOnly: true, persist: true };

        const res = await fetchJson<{
          stress?: StressRow[];
          comparison?: StrategyComparison;
          error?: string;
        }>("/api/learning/backtests/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.error) {
          setError(res.error);
        }
        if (mode === "real_baseline" && res.stress) {
          setStressResults(res.stress);
        }
        if (mode === "compare" && res.comparison) {
          setComparison(res.comparison);
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : `${mode} run failed`);
      } finally {
        setRunning(null);
      }
    },
    [refresh],
  );

  const pollJob = useCallback(async (jobId: string): Promise<BackgroundJobPoll> => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const res = await fetchJson<{ job?: BackgroundJobPoll }>(
        `/api/learning/jobs?id=${encodeURIComponent(jobId)}`,
      );
      const job = res.job;
      if (!job) throw new Error("Job not found");
      setJobStatus(`${job.message || job.status} (${job.progress}%)`);
      if (job.status === "completed") return job;
      if (job.status === "failed") throw new Error(job.error ?? "Job failed");
      if (job.status === "cancelled") throw new Error("Job cancelled");
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("Job timed out");
  }, []);

  const runReconcile = useCallback(async () => {
    setJobBusy("reconcile");
    setReconcileNote(null);
    setJobStatus("Starting reconcile…");
    try {
      const res = await fetchJson<{ jobId: string }>("/api/learning/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reconcile" }),
      });
      const job = await pollJob(res.jobId);
      const result = job.result as { causeHint?: string } | null;
      setReconcileNote(
        result?.causeHint ??
          "Reconcile complete. Compare only runs with matching fingerprints.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconcile failed");
    } finally {
      setJobBusy(null);
      setJobStatus(null);
    }
  }, [pollJob, refresh]);

  const runCreateExperiment = useCallback(
    async (kind: string) => {
      setJobBusy(`experiment:${kind}`);
      setJobStatus("Creating experiment…");
      try {
        const res = await fetchJson<{ jobId: string }>("/api/learning/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "create_experiment", kind }),
        });
        await pollJob(res.jobId);
        await refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Create experiment failed",
        );
      } finally {
        setJobBusy(null);
        setJobStatus(null);
      }
    },
    [pollJob, refresh],
  );

  const runShadowAction = useCallback(
    async (action: "start" | "stop") => {
      setShadowBusy(true);
      try {
        await fetchJson("/api/learning/shadow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : `Shadow ${action} failed`);
      } finally {
        setShadowBusy(false);
      }
    },
    [refresh],
  );

  const b = data?.baseline;
  const bt = data?.backtest;
  const coverage = data?.coverage;
  const shadow = data?.shadow;
  const evidence = data?.evidence;
  const challenger = data?.challenger;
  const liveShadow = data?.liveShadow;
  const weakness = data?.weakness;
  const typedExperiments = data?.typedExperiments ?? [];

  const syntheticBt =
    bt?.syntheticDataUsed === true ? bt : null;
  const realBt =
    bt?.realDataOnly === true && bt.syntheticDataUsed === false ? bt : null;

  const strongest = b?.regimes[0];
  const weakest =
    b?.regimes.length ? b.regimes[b.regimes.length - 1] : undefined;

  const expGroups = {
    draft: (data?.experiments ?? []).filter((e) => e.status === "DRAFT"),
    backtesting: (data?.experiments ?? []).filter(
      (e) => e.status === "BACKTESTING",
    ),
    rejected: (data?.experiments ?? []).filter((e) => e.status === "REJECTED"),
    validation: (data?.experiments ?? []).filter((e) =>
      ["SHADOW", "PAPER_CANDIDATE", "CHAMPION"].includes(e.status),
    ),
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Strategy Lab"
        description="Select and review the active paper strategy. Research tools stay collapsed."
      />

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <Panel title="Current Champion">
        {b ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-200">
              <strong className="text-zinc-50">{b.champion.name}</strong>
              {" · "}
              {b.champion.version}
              {" · "}
              <span className="text-emerald-300">{b.champion.status}</span>
            </p>
            <p className="text-xs text-zinc-400">
              Read-only research view. Live paper strategy is not modified here.
            </p>
            <ExpandableSection
              title="Champion identifiers"
              summary="Active-since and strategy identifiers."
              expandLabel="View identifiers"
              collapseLabel="Hide identifiers"
            >
              <p className="text-xs text-zinc-500">
                Active since{" "}
                {new Date(b.champion.activeSince).toLocaleDateString()} ·
                Strategy ID {b.champion.strategyId}
              </p>
            </ExpandableSection>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Total paper trades"
                value={String(b.performance.totalPaperTrades)}
              />
              <Metric label="Win rate" value={fmtPct(b.performance.winRate)} />
              <Metric
                label="Profit factor"
                value={fmtNum(b.performance.profitFactor)}
              />
              <Metric
                label="Expectancy"
                value={fmtNum(b.performance.expectancy)}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Loading champion…</p>
        )}
      </Panel>

      <ExpandableSection
        title="Trading research (I-2)"
        expandLabel="View trading research"
        collapseLabel="Hide trading research"
        summary="Baseline, walk-forward, OOS, breakdowns, experiments, and promotion eligibility."
      >
        <div className="flex flex-col gap-5">
        <Panel title="A. Baseline Backtest">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={running !== null}
              onClick={() => void runAction("baseline")}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              {running === "baseline"
                ? "Running…"
                : "Run Paper Intelligence v1 baseline"}
            </button>
            <p className="text-xs text-zinc-500">
              Simulation only — no broker orders. Synthetic history used when live
              bars are unavailable.
            </p>
          </div>
          {syntheticBt ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-200">
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-200">
                  Synthetic
                </span>{" "}
                Strategy {syntheticBt.strategyVersion} · {syntheticBt.periodStart} →{" "}
                {syntheticBt.periodEnd} · {syntheticBt.timeframe} ·{" "}
                {syntheticBt.symbols.join(", ")}
              </p>
              <BacktestMetricsGrid bt={syntheticBt} />
              <p className="text-xs text-zinc-400">
                Execution: spread={syntheticBt.assumptions.spreadModel} (
                {syntheticBt.assumptions.fixedSpreadBps} bps) · slippage=
                {syntheticBt.assumptions.slippageModel} (
                {syntheticBt.assumptions.fixedSlippageBps} bps)
              </p>
              <p className="text-xs text-zinc-400">
                Data quality:{" "}
                {syntheticBt.dataQuality.passed ? (
                  <span className="text-emerald-300">passed</span>
                ) : (
                  <span className="text-amber-300">blocking issues</span>
                )}{" "}
                · {syntheticBt.dataQuality.warnings.length} warnings ·{" "}
                {syntheticBt.dataQuality.blocking.length} blocking
              </p>
              {syntheticBt.metrics.statisticallyWeak ? (
                <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  {syntheticBt.metrics.weakReason}
                </p>
              ) : null}
              <p className="text-xs text-zinc-600">{syntheticBt.disclaimer}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              No synthetic baseline backtest stored yet. Run one to populate I-2
              synthetic metrics. Real historical results appear in I-3 B.
            </p>
          )}
        </Panel>

        <Panel title="B. Walk-Forward Results">
          {bt?.walkForward ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Total folds"
                  value={String(bt.walkForward.totalFolds)}
                />
                <Metric
                  label="Passing"
                  value={String(bt.walkForward.passingFolds)}
                />
                <Metric
                  label="Failing"
                  value={String(bt.walkForward.failingFolds)}
                />
                <Metric
                  label="Median fold return"
                  value={fmtNum(bt.walkForward.medianFoldReturn)}
                />
              </div>
              <p className="text-sm text-zinc-300">
                Best fold #{bt.walkForward.bestFold?.foldIndex ?? "—"} (
                {fmtNum(bt.walkForward.bestFold?.totalReturn)}) · Worst #
                {bt.walkForward.worstFold?.foldIndex ?? "—"} (
                {fmtNum(bt.walkForward.worstFold?.totalReturn)})
              </p>
              <p className="text-xs text-zinc-400">
                {bt.walkForward.performanceDecayHint}
              </p>
              <p className="text-xs text-zinc-400">
                {bt.walkForward.parameterStabilityHint}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="py-1 pr-2">Fold</th>
                      <th className="py-1 pr-2">Train</th>
                      <th className="py-1 pr-2">Validate</th>
                      <th className="py-1 pr-2">Trades</th>
                      <th className="py-1 pr-2">Return</th>
                      <th className="py-1 pr-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bt.folds.slice(0, 12).map((f) => (
                      <tr key={f.foldIndex} className="border-t border-zinc-800">
                        <td className="py-1.5 pr-2 text-zinc-200">{f.foldIndex}</td>
                        <td className="py-1.5 pr-2 text-zinc-400">
                          {f.trainingStart}→{f.trainingEnd}
                        </td>
                        <td className="py-1.5 pr-2 text-zinc-400">
                          {f.validationStart}→{f.validationEnd}
                        </td>
                        <td className="py-1.5 pr-2">{f.trades}</td>
                        <td className="py-1.5 pr-2 font-mono">
                          {fmtNum(f.totalReturn)}
                        </td>
                        <td className="py-1.5 pr-2">
                          {f.passed ? (
                            <span className="text-emerald-300">pass</span>
                          ) : (
                            <span className="text-amber-200">
                              fail{f.failReason ? `: ${f.failReason}` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Walk-forward folds appear after a baseline run.
            </p>
          )}
        </Panel>

        <Panel title="C. Out-of-Sample Results">
          {bt?.split?.outOfSample ? (
            <div className="space-y-2">
              <p className="text-sm text-zinc-200">
                Locked range: {bt.split.outOfSample.start} →{" "}
                {bt.split.outOfSample.end}
                {bt.split.outOfSampleLocked ? " (locked)" : ""}
              </p>
              <p className="text-xs text-zinc-400">
                Purge gap: {bt.split.purgeGapDays} day(s) · Train{" "}
                {bt.split.training.start}→{bt.split.training.end} · Validation{" "}
                {bt.split.validation.start}→{bt.split.validation.end}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Metric
                  label="Baseline trades (full period)"
                  value={String(bt.metrics.totalTrades)}
                />
                <Metric
                  label="Expectancy"
                  value={fmtNum(bt.metrics.expectancy)}
                />
                <Metric
                  label="Max drawdown"
                  value={fmtPct(bt.metrics.maxDrawdown)}
                />
              </div>
              {bt.metrics.statisticallyWeak ? (
                <p className="text-sm text-amber-200">
                  Trade count is too small for meaningful OOS conclusions.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No locked OOS split yet.</p>
          )}
        </Panel>

        <Panel title="D. Performance Breakdown">
          {bt ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <BreakdownList
                title="By symbol"
                rows={Object.entries(bt.metrics.bySymbol)}
              />
              <BreakdownList
                title="By regime"
                rows={Object.entries(bt.metrics.byRegime)}
              />
              <BreakdownList
                title="By month"
                rows={Object.entries(bt.metrics.byMonth)}
              />
              <BreakdownList
                title="By time of day (ET hour)"
                rows={Object.entries(bt.metrics.byHourEt)}
              />
              <BreakdownList
                title="By confidence bucket"
                rows={Object.entries(bt.metrics.byConfidence)}
              />
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Run a baseline to see breakdowns.</p>
          )}
        </Panel>

        <Panel title="E. Experiments">
          <p className="mb-3 text-xs text-zinc-500">
            Challengers create new immutable draft versions. Champion cannot be
            overwritten. Promotion is disabled in I-2.
          </p>
          {(
            [
              ["Draft", expGroups.draft],
              ["Backtesting", expGroups.backtesting],
              ["Rejected", expGroups.rejected],
              ["Validation complete / champion", expGroups.validation],
            ] as const
          ).map(([label, list]) => (
            <div key={label} className="mb-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {label}
              </h3>
              {list.length === 0 ? (
                <p className="text-sm text-zinc-600">None</p>
              ) : (
                <ul className="space-y-2">
                  {list.map((e) => (
                    <li
                      key={`${e.strategyId}:${e.version}`}
                      className="rounded border border-zinc-800 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-medium text-zinc-100">
                          {e.name} {e.version}
                        </span>
                        <span className="text-zinc-400">{e.status}</span>
                      </div>
                      {e.parentVersion ? (
                        <p className="mt-1 text-xs text-zinc-500">
                          Parent {e.parentVersion}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Panel>

        <Panel title="F. Promotion Eligibility">
          {bt?.promotion ? (
            <div className="space-y-3">
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-emerald-400/80">
                    Passed
                  </h3>
                  <ul className="space-y-1 text-sm text-zinc-300">
                    {bt.promotion.checks
                      .filter((c) => c.passed)
                      .map((c) => (
                        <li key={c.id}>
                          {c.label}{" "}
                          <span className="text-zinc-500">({c.detail})</span>
                        </li>
                      ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-amber-300/80">
                    Failed / pending
                  </h3>
                  <ul className="space-y-1 text-sm text-zinc-300">
                    {bt.promotion.checks
                      .filter((c) => !c.passed)
                      .map((c) => (
                        <li key={c.id}>
                          {c.label}{" "}
                          <span className="text-zinc-500">({c.detail})</span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
              <p className="text-sm text-zinc-400">
                Manual approval is still required. Promotion actions are disabled
                for Milestone I-2 (later milestones).
              </p>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-500 opacity-60"
                title="Promotion disabled until later milestones"
              >
                Promote (disabled)
              </button>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Eligibility appears after a stored backtest run.
            </p>
          )}
        </Panel>
        </div>
      </ExpandableSection>


      <ExpandableSection
        title="Evidence pack (I-3)"
        expandLabel="View evidence pack"
        collapseLabel="Hide evidence pack"
        summary="Data coverage, real baseline, stress, regimes, comparison, shadow, and checklist."
      >
        <div className="flex flex-col gap-5">
        <Panel title="I-3 A. Data Coverage">
          {coverage ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Metric label="Symbols tracked" value={String(coverage.total)} />
                <Metric label="Ready" value={String(coverage.ready)} />
                <Metric
                  label="Blocked / partial"
                  value={String(coverage.total - coverage.ready)}
                />
              </div>
              {coverage.rows.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No cached historical files yet. Download history before running a
                  real baseline.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="text-xs uppercase text-zinc-500">
                      <tr>
                        <th className="py-1 pr-2">Symbol</th>
                        <th className="py-1 pr-2">Status</th>
                        <th className="py-1 pr-2">Coverage</th>
                        <th className="py-1 pr-2">Bars</th>
                        <th className="py-1 pr-2">Range</th>
                        <th className="py-1 pr-2">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coverage.rows.slice(0, 20).map((row) => (
                        <tr key={row.symbol} className="border-t border-zinc-800">
                          <td className="py-1.5 pr-2 text-zinc-200">{row.symbol}</td>
                          <td className="py-1.5 pr-2">
                            <span
                              className={
                                row.status === "READY"
                                  ? "text-emerald-300"
                                  : row.status === "BLOCKED"
                                    ? "text-red-300"
                                    : "text-amber-200"
                              }
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 font-mono">
                            {row.coveragePercentage != null
                              ? `${row.coveragePercentage.toFixed(0)}%`
                              : "—"}
                          </td>
                          <td className="py-1.5 pr-2 font-mono">
                            {row.actualCandles}
                            {row.expectedCandles != null
                              ? ` / ${row.expectedCandles}`
                              : ""}
                          </td>
                          <td className="py-1.5 pr-2 text-xs text-zinc-400">
                            {row.earliest ?? "—"} → {row.latest ?? "—"}
                          </td>
                          <td className="py-1.5 pr-2 text-xs text-zinc-400">
                            {row.dataSource}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-zinc-500">
                Real-data backtests require READY coverage. Synthetic fills are not
                used when realDataOnly is enforced.
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Loading coverage inventory…</p>
          )}
        </Panel>

        <Panel title="I-3 B. Real Historical Baseline">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={running !== null}
              onClick={() => void runAction("real_baseline")}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              {running === "real_baseline"
                ? "Running…"
                : "Run real historical baseline"}
            </button>
            <p className="text-xs text-zinc-500">
              Uses cached Alpaca/IEX bars only. No synthetic candles. Simulation
              only — no broker orders.
            </p>
          </div>
          {realBt ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-200">
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-medium text-emerald-200">
                  Real historical
                </span>{" "}
                {realBt.label ?? "REAL HISTORICAL BACKTEST"} ·{" "}
                {realBt.strategyVersion} · {realBt.periodStart} →{" "}
                {realBt.periodEnd} · {realBt.timeframe}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Coverage"
                  value={
                    realBt.coveragePercentage != null
                      ? `${realBt.coveragePercentage.toFixed(0)}%`
                      : "—"
                  }
                />
                <Metric
                  label="Data quality"
                  value={realBt.dataQualityStatus ?? "—"}
                />
                <Metric
                  label="Symbols"
                  value={String(realBt.symbols.length)}
                />
                <Metric
                  label="Excluded"
                  value={String(realBt.excludedSymbols?.length ?? 0)}
                />
              </div>
              <BacktestMetricsGrid bt={realBt} />
              {(realBt.excludedSymbols?.length ?? 0) > 0 ? (
                <p className="text-xs text-amber-200">
                  Excluded:{" "}
                  {realBt.excludedSymbols!
                    .map((x) => `${x.symbol} (${x.reason})`)
                    .join(", ")}
                </p>
              ) : null}
              {realBt.sourceBySymbol &&
              Object.keys(realBt.sourceBySymbol).length > 0 ? (
                <ul className="space-y-1 text-xs text-zinc-400">
                  {Object.entries(realBt.sourceBySymbol)
                    .slice(0, 12)
                    .map(([sym, src]) => (
                      <li key={sym}>
                        {sym}: {src}
                      </li>
                    ))}
                </ul>
              ) : null}
              <p className="text-xs text-zinc-600">{realBt.disclaimer}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              No real historical baseline stored yet. Ensure data coverage is READY,
              then run a real baseline.
            </p>
          )}
        </Panel>

        <Panel title="I-3 C. Stress Test Results">
          {stressResults && stressResults.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">
                Cost and fill stress scenarios from the latest real baseline run.
                Fragile scenarios must not improve vs base under accounting rules.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="py-1 pr-2">Scenario</th>
                      <th className="py-1 pr-2">Trades</th>
                      <th className="py-1 pr-2">Expectancy</th>
                      <th className="py-1 pr-2">PF</th>
                      <th className="py-1 pr-2">Return</th>
                      <th className="py-1 pr-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stressResults.map((s) => (
                      <tr key={s.id} className="border-t border-zinc-800">
                        <td className="py-1.5 pr-2 text-zinc-200">{s.label}</td>
                        <td className="py-1.5 pr-2">{s.trades}</td>
                        <td className="py-1.5 pr-2 font-mono">
                          {fmtNum(s.expectancy, 4)}
                        </td>
                        <td className="py-1.5 pr-2 font-mono">
                          {fmtNum(s.profitFactor)}
                        </td>
                        <td className="py-1.5 pr-2 font-mono">
                          {fmtNum(s.totalReturnAfterCosts)}
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-amber-200">
                          {s.fragileHint ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Stress scenarios run with a real historical baseline. Use &quot;Run
              real historical baseline&quot; in I-3 B to populate.
            </p>
          )}
        </Panel>

        <Panel title="I-3 D. Regime Coverage">
          {bt?.regimes && bt.regimes.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">
                Backtest regime buckets with sample-size warnings (≥15 trades for
                meaningful stats).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="py-1 pr-2">Regime</th>
                      <th className="py-1 pr-2">Trades</th>
                      <th className="py-1 pr-2">Win rate</th>
                      <th className="py-1 pr-2">Expectancy</th>
                      <th className="py-1 pr-2">PF</th>
                      <th className="py-1 pr-2">PnL</th>
                      <th className="py-1 pr-2">Sample</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bt.regimes.map((r) => (
                      <tr key={r.regime} className="border-t border-zinc-800">
                        <td className="py-1.5 pr-2 text-zinc-200">{r.regime}</td>
                        <td className="py-1.5 pr-2">{r.trades}</td>
                        <td className="py-1.5 pr-2">{fmtPct(r.winRate)}</td>
                        <td className="py-1.5 pr-2 font-mono">
                          {fmtNum(r.expectancy, 4)}
                        </td>
                        <td className="py-1.5 pr-2 font-mono">
                          {fmtNum(r.profitFactor)}
                        </td>
                        <td className="py-1.5 pr-2 font-mono">
                          {fmtNum(r.pnl)}
                        </td>
                        <td className="py-1.5 pr-2 text-xs">
                          {r.insufficientSample ? (
                            <span className="text-amber-200">
                              {r.sampleWarning ?? "low sample"}
                            </span>
                          ) : (
                            <span className="text-emerald-300">ok</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Regime coverage appears after a stored backtest with trade labels.
            </p>
          )}
        </Panel>

        <Panel title="I-3 E. Champion vs Challenger">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={running !== null}
              onClick={() => void runAction("compare")}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              {running === "compare"
                ? "Comparing…"
                : "Compare champion vs challenger"}
            </button>
            <p className="text-xs text-zinc-500">
              Same-dataset real-data comparison. Challenger results are simulated and
              did not submit broker orders.
            </p>
          </div>
          {challenger ? (
            <p className="mb-3 text-sm text-zinc-300">
              Registered challenger:{" "}
              <strong className="text-zinc-100">
                {challenger.name} {challenger.version}
              </strong>{" "}
              ({challenger.status})
              {challenger.parentVersion
                ? ` · parent ${challenger.parentVersion}`
                : ""}
            </p>
          ) : (
            <p className="mb-3 text-sm text-zinc-500">
              No regime-filter challenger registered yet.
            </p>
          )}
          {comparison ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-200">
                {comparison.periodStart} → {comparison.periodEnd} ·{" "}
                {comparison.symbols.length} symbols · dataset{" "}
                {comparison.datasetId}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Champion trades"
                  value={String(comparison.champion.trades)}
                />
                <Metric
                  label="Challenger trades"
                  value={String(comparison.challenger.trades)}
                />
                <Metric
                  label="Δ expectancy"
                  value={fmtNum(comparison.deltas.expectancy, 4)}
                />
                <Metric
                  label="Δ return ($)"
                  value={fmtNum(comparison.deltas.totalReturnAfterCosts)}
                />
                <Metric
                  label="Champion PF"
                  value={fmtNum(comparison.champion.profitFactor)}
                />
                <Metric
                  label="Challenger PF"
                  value={fmtNum(comparison.challenger.profitFactor)}
                />
                <Metric
                  label="Champion max DD"
                  value={fmtPct(comparison.champion.maxDrawdown)}
                />
                <Metric
                  label="Challenger max DD"
                  value={fmtPct(comparison.challenger.maxDrawdown)}
                />
              </div>
              <p className="text-xs text-zinc-400">
                Winning months — champion {comparison.monthlyConsistency.championWinningMonths}{" "}
                / challenger {comparison.monthlyConsistency.challengerWinningMonths}
                {" · "}
                Losing months — champion{" "}
                {comparison.monthlyConsistency.championLosingMonths} / challenger{" "}
                {comparison.monthlyConsistency.challengerLosingMonths}
              </p>
              {comparison.regimeNotes.length > 0 ? (
                <ul className="space-y-1 text-xs text-amber-200">
                  {comparison.regimeNotes.slice(0, 6).map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-zinc-400">{comparison.oosDecayHint}</p>
              <p className="text-xs text-zinc-600">{comparison.disclaimer}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Run a comparison to see side-by-side metrics on the same historical
              dataset.
            </p>
          )}
        </Panel>

        <Panel title="I-3 F. Shadow Mode">
          {shadow ? (
            <div className="space-y-3">
              <p className="text-xs text-amber-200">{shadow.note}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Sessions"
                  value={String(shadow.sessionsCompleted)}
                />
                <Metric
                  label="Champion proposals"
                  value={String(shadow.championProposals)}
                />
                <Metric
                  label="Challenger proposals"
                  value={String(shadow.challengerProposals)}
                />
                <Metric
                  label="Matching proposals"
                  value={String(shadow.matchingProposals)}
                />
                <Metric
                  label="Champion only"
                  value={String(shadow.championOnly)}
                />
                <Metric
                  label="Challenger only"
                  value={String(shadow.challengerOnly)}
                />
                <Metric
                  label="Simulated trades"
                  value={String(shadow.simulatedTrades)}
                />
                <Metric
                  label="Safety violations"
                  value={String(shadow.safetyViolations)}
                />
              </div>
              {Object.keys(shadow.byRegime).length > 0 ? (
                <ul className="space-y-1 text-sm text-zinc-300">
                  {Object.entries(shadow.byRegime)
                    .slice(0, 8)
                    .map(([regime, count]) => (
                      <li key={regime} className="flex justify-between gap-2">
                        <span>{regime}</span>
                        <span className="font-mono text-zinc-100">{count}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-500">
                  No challenger shadow proposals by regime yet.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Loading shadow summary…</p>
          )}
        </Panel>

        <Panel title="I-3 G. Evidence Checklist">
          {evidence ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">{evidence.note}</p>
              {evidence.syntheticCannotSatisfy ? (
                <p className="text-xs text-amber-200">
                  Synthetic backtests cannot satisfy I-3 promotion evidence
                  thresholds.
                </p>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <EvidenceList
                  title="Historical evidence"
                  items={evidence.historical}
                  passedTone="pass"
                />
                <EvidenceList
                  title="Shadow evidence"
                  items={evidence.shadow}
                  passedTone="pass"
                />
              </div>
              {evidence.failed.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-amber-300/80">
                    Not yet satisfied ({evidence.failed.length})
                  </h3>
                  <ul className="space-y-1 text-sm text-zinc-300">
                    {evidence.failed.map((item) => (
                      <li key={item.id}>
                        {item.label}{" "}
                        <span className="text-zinc-500">({item.detail})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-emerald-300">
                  All checklist items passed (informational only).
                </p>
              )}
              <p className="text-sm text-zinc-400">
                Evidence thresholds indicate sufficiency only. Promotion remains
                disabled for Milestone I-3 (later milestones).
              </p>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-500 opacity-60"
                title="Promotion disabled until later milestones"
              >
                Promote (disabled)
              </button>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Evidence checklist loads after summary data is available.
            </p>
          )}
        </Panel>
        </div>
      </ExpandableSection>


      <ExpandableSection
        title="Promotion readiness (I-4)"
        expandLabel="View promotion readiness"
        collapseLabel="Hide promotion readiness"
        summary="Metric consistency, live shadow, weakness analysis, experiments, and safety."
      >
        <div className="flex flex-col gap-5">
        <Panel title="I-4 A. Metric Consistency">
          {bt ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Run ID" value={bt.id.slice(0, 12)} />
                <Metric
                  label="Fingerprint hash"
                  value={bt.runFingerprint?.hash?.slice(0, 12) ?? "—"}
                />
                <Metric
                  label="Created"
                  value={
                    bt.createdAt
                      ? new Date(bt.createdAt).toLocaleString()
                      : "—"
                  }
                />
                <Metric
                  label="Trade count"
                  value={String(bt.metrics.totalTrades)}
                />
              </div>
              {bt.comparableNote ? (
                <p className="text-sm text-zinc-300">{bt.comparableNote}</p>
              ) : null}
              <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                The PF 1.07 vs 1.19 discrepancy in I-3 stress results was caused by
                thinned stress bars (every 3rd bar) versus the full baseline
                evalStep=24 run. These runs are non-comparable — only compare metrics
                when run fingerprints match.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={jobBusy !== null}
                  onClick={() => void runReconcile()}
                  className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
                >
                  {jobBusy === "reconcile" ? "Reconciling…" : "Reconcile metrics"}
                </button>
                {jobStatus && jobBusy === "reconcile" ? (
                  <p className="text-xs text-zinc-400">{jobStatus}</p>
                ) : null}
              </div>
              {reconcileNote ? (
                <p className="text-sm text-emerald-200">{reconcileNote}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Run a stored backtest to see fingerprint and metric consistency info.
            </p>
          )}
        </Panel>

        <Panel title="I-4 B. Live Shadow Control">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={shadowBusy || liveShadow?.active != null}
              onClick={() => void runShadowAction("start")}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              {shadowBusy && !liveShadow?.active
                ? "Starting…"
                : "Start Shadow Session"}
            </button>
            <button
              type="button"
              disabled={shadowBusy || liveShadow?.active == null}
              onClick={() => void runShadowAction("stop")}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              {shadowBusy && liveShadow?.active ? "Stopping…" : "Stop Shadow Session"}
            </button>
            <p className="text-xs text-zinc-500">
              Starting a shadow session does not enable execution or auto trading.
              Challenger proposals are simulated only.
            </p>
          </div>
          {liveShadow?.active ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-200">
                Active session {liveShadow.active.sessionId.slice(0, 12)} ·{" "}
                <span className="text-emerald-300">{liveShadow.active.status}</span>
                {" · "}
                Champion {liveShadow.active.championVersion} vs challenger{" "}
                {liveShadow.active.challengerVersion}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Scans processed"
                  value={String(liveShadow.active.scansProcessed)}
                />
                <Metric
                  label="Champion proposals"
                  value={String(liveShadow.active.championProposals)}
                />
                <Metric
                  label="Challenger proposals"
                  value={String(liveShadow.active.challengerProposals)}
                />
                <Metric
                  label="Open sim positions"
                  value={String(liveShadow.active.openSimPositions)}
                />
              </div>
              {(liveShadow.active.missingDataWarnings?.length ?? 0) > 0 ? (
                <ul className="space-y-1 text-xs text-amber-200">
                  {liveShadow.active.missingDataWarnings.slice(-5).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No active shadow session.</p>
          )}
          {(liveShadow?.sessions?.length ?? 0) > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="py-1 pr-2">Session</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Validity</th>
                    <th className="py-1 pr-2">Scans</th>
                    <th className="py-1 pr-2">Challenger props</th>
                  </tr>
                </thead>
                <tbody>
                  {liveShadow!.sessions.slice(0, 10).map((s) => (
                    <tr key={s.sessionId} className="border-t border-zinc-800">
                      <td className="py-1.5 pr-2 font-mono text-zinc-200">
                        {s.sessionId.slice(0, 10)}
                      </td>
                      <td className="py-1.5 pr-2">{s.status}</td>
                      <td className="py-1.5 pr-2">{s.validity ?? "—"}</td>
                      <td className="py-1.5 pr-2">{s.scans}</td>
                      <td className="py-1.5 pr-2">{s.challengerProposals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>

        <Panel title="I-4 C. Shadow Evidence">
          {liveShadow?.evidence ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Valid sessions"
                  value={`${liveShadow.evidence.validSessions} / ${liveShadow.evidence.targetSessions}`}
                />
                <Metric
                  label="Challenger proposals"
                  value={`${liveShadow.evidence.challengerProposals} / ${liveShadow.evidence.targetProposals}`}
                />
                <Metric
                  label="Safety violations"
                  value={String(liveShadow.evidence.safetyViolations)}
                />
                <Metric
                  label="Incomplete sessions"
                  value={String(liveShadow.evidence.incompleteSessions)}
                />
              </div>
              {liveShadow.evidence.regimesSeen.length > 0 ? (
                <p className="text-sm text-zinc-300">
                  Regimes seen: {liveShadow.evidence.regimesSeen.join(", ")}
                </p>
              ) : null}
              <p className="text-xs text-zinc-500">{liveShadow.evidence.note}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Loading shadow evidence progress…</p>
          )}
        </Panel>

        <Panel title="I-4 D. Weakness Analysis">
          {weakness ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">{weakness.note}</p>
              {weakness.findings.length === 0 ? (
                <p className="text-sm text-zinc-500">No weakness findings yet.</p>
              ) : (
                <ul className="space-y-2">
                  {weakness.findings.slice(0, 20).map((f) => (
                    <li
                      key={f.id}
                      className="rounded border border-zinc-800 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-zinc-100">{f.label}</span>
                        <span
                          className={
                            f.enoughEvidence
                              ? "text-emerald-300"
                              : "text-amber-200"
                          }
                        >
                          {f.enoughEvidence ? "enough evidence" : "insufficient sample"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {f.category} · n={f.sampleSize}
                        {f.expectancy != null
                          ? ` · expectancy ${fmtNum(f.expectancy, 4)}`
                          : ""}
                        {f.profitFactor != null
                          ? ` · PF ${fmtNum(f.profitFactor)}`
                          : ""}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">{f.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
              {weakness.actionableFindings.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Actionable (enough evidence)
                  </h3>
                  <ul className="space-y-1 text-sm text-zinc-300">
                    {weakness.actionableFindings.slice(0, 8).map((f) => (
                      <li key={f.id}>
                        {f.label} (n={f.sampleSize}) — {f.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              Weakness analysis requires a real historical backtest run.
            </p>
          )}
        </Panel>

        <Panel title="I-4 E. Challenger Experiments">
          <p className="mb-3 text-xs text-zinc-500">
            Typed experiments lock acceptance criteria at creation. Max 3 kinds beyond
            the regime-filter challenger.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {EXPERIMENT_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                disabled={jobBusy !== null}
                onClick={() => void runCreateExperiment(kind)}
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
              >
                {jobBusy === `experiment:${kind}` ? "Creating…" : `Create ${label}`}
              </button>
            ))}
          </div>
          {jobStatus && jobBusy?.startsWith("experiment:") ? (
            <p className="mb-3 text-xs text-zinc-400">{jobStatus}</p>
          ) : null}
          {typedExperiments.length === 0 ? (
            <p className="text-sm text-zinc-500">No typed experiments yet.</p>
          ) : (
            <ul className="space-y-2">
              {typedExperiments.map((exp) => (
                <li
                  key={exp.id}
                  className="rounded border border-zinc-800 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-zinc-100">
                      {exp.name} {exp.version}
                    </span>
                    <span className="text-zinc-400">
                      {exp.kind} · {exp.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-300">
                    Hypothesis: {exp.acceptance.hypothesis}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Expected benefit: {exp.acceptance.expectedBenefit} · Main risk:{" "}
                    {exp.acceptance.mainRisk}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="I-4 F. Safety">
          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-center gap-2">
              <span className="text-emerald-300">✓</span>
              Challenger broker access blocked
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-300">✓</span>
              Promotion disabled
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-300">✓</span>
              Live trading blocked
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-300">✓</span>
              Champion unchanged — registry versions are immutable
            </li>
          </ul>
          <p className="mt-3 text-sm text-zinc-400">
            Manual approval and live promotion remain disabled for Milestone I-4 (later
            milestones).
          </p>
          <button
            type="button"
            disabled
            className="mt-3 cursor-not-allowed rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-500 opacity-60"
            title="Promotion disabled until later milestones"
          >
            Promote (disabled)
          </button>
        </Panel>
        </div>
      </ExpandableSection>


      <ExpandableSection
        title="Additional research"
        expandLabel="View additional research"
        collapseLabel="Hide additional research"
        summary="Paper regime performance and recent trade reviews."
      >
        <div className="flex flex-col gap-5">
        <Panel title="Market-Regime Performance (paper learning)">
          {b && b.regimes.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">
                Strongest observed:{" "}
                <strong className="text-zinc-200">
                  {strongest?.label ?? "—"}
                </strong>
                {" · "}
                Weakest / least data:{" "}
                <strong className="text-zinc-200">
                  {weakest?.label ?? "—"}
                </strong>
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {b.regimes.map((r) => (
                  <li
                    key={r.regime}
                    className="flex justify-between rounded border border-zinc-800 px-3 py-2 text-sm"
                  >
                    <span className="text-zinc-300">{r.label}</span>
                    <span className="font-mono text-zinc-100">{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No regime-labeled events yet.</p>
          )}
        </Panel>

        <Panel title="Recent trade reviews">
          {(data?.recentReviews?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No post-trade reviews yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data!.recentReviews.map((r) => (
                <li
                  key={r.id}
                  className="rounded border border-zinc-800 px-3 py-2"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-zinc-100">{r.symbol}</span>
                    <span className="text-zinc-400">
                      {r.classification.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">{r.primaryReason}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        </div>
      </ExpandableSection>

      <p className="text-xs text-zinc-600">{b?.session.note}</p>
    </div>
  );
}
