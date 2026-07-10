"use client";

import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { formatMoney, formatNumber, formatTime } from "@/lib/format";
import { fetchJson } from "@/lib/client/fetch-json";
import type {
  AiDecision,
  DecisionHistoryEntry,
  MarketClockStatus,
} from "@/lib/alpaca/types";
import type {
  AccountPayload,
  AiHealthPayload,
  DashboardData,
  DecisionPayload,
  MarketPayload,
  NewsPayload,
  PerformancePayload,
  SafetyPayload,
  TradeRow,
} from "@/lib/dashboard-types";
import type { MarketCondition } from "@/lib/stocks/market-condition";
import type {
  PaperOrderPreview,
  PaperOrderSubmitResult,
} from "@/lib/trades/types";
import {
  actionToSide,
  canShowPreparePaperTrade,
  isPreparableAction,
} from "@/lib/trades/gates";
import {
  collectUiBlockExplanations,
  submitButtonState,
} from "@/lib/trades/block-explanations";
import type { OrderGateBlocker } from "@/lib/trades/types";
import { Panel } from "@/components/ui/Panel";
import {
  ActionBadge,
  ConfidenceBar,
  ExecutionLockHint,
  RiskBadge,
  ScoreBadges,
  SentimentBadge,
} from "@/components/ui/badges";
import { BlockReasonList } from "@/components/ui/BlockReasonList";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { SafetyStrip } from "@/components/ui/SafetyStrip";
import { AiCommandCenter } from "@/components/AiCommandCenter";
import { DashboardSummary } from "@/components/control-room/DashboardSummary";
import { WatchlistDetailPanel } from "@/components/control-room/WatchlistDetailPanel";
import { PaperTradeBlockPanel } from "@/components/trades/PaperTradeBlockPanel";
import { useUiChrome } from "@/components/layout/UiChromeContext";
import {
  aiStatusDisplayLabel,
  withoutGlobalBlockKinds,
} from "@/lib/client/block-reasons";
import {
  collectRowBlockReasons,
  DEFAULT_WATCHLIST_FILTERS,
  filterAndSortWatchlist,
  rowIsTradable,
  type WatchlistFilters,
  type WatchlistViewRow,
} from "@/lib/client/watchlist-filters";
import { loadUiSettings, addLocalWatchlistSymbol, getLocalWatchlistSymbols, subscribeUiSettings } from "@/lib/client/ui-settings";
import type { AiCommandRequest } from "@/lib/ai/command-types";
import type { SymbolNewsAnalysis } from "@/lib/news/types";
import { filterUsStockSymbols } from "@/lib/stocks/universe";

function trendLabel(d: AiDecision | null | undefined): string {
  const pct = d?.metrics?.trendPct;
  if (pct == null) return "—";
  if (pct > 0.0015) return `Up ${(pct * 100).toFixed(2)}%`;
  if (pct < -0.0015) return `Down ${(pct * 100).toFixed(2)}%`;
  return `Flat ${(pct * 100).toFixed(2)}%`;
}

function MarketConditionBanner({
  condition,
}: {
  condition: MarketCondition | null;
}) {
  if (!condition) {
    return (
      <div className="ui-card text-base text-[var(--muted)]">
        Market condition (SPY/QQQ) unavailable
      </div>
    );
  }
  const tone =
    condition.label === "bullish"
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
      : condition.label === "bearish"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
        : "border-amber-500/40 bg-amber-500/10 text-amber-100";
  return (
    <div className={`rounded-[var(--radius)] border px-5 py-4 text-base ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-lg font-semibold capitalize">
          Market {condition.label}
        </span>
        <span className="text-sm opacity-90">
          Score {(condition.marketScore * 100).toFixed(0)}%
        </span>
      </div>
      <p className="mt-2 text-base leading-relaxed opacity-90">
        {condition.explanation}
      </p>
    </div>
  );
}

function AiHealthBanner({
  aiHealth,
  onRefresh,
  busy,
}: {
  aiHealth: AiHealthPayload | null;
  onRefresh: () => void;
  busy: boolean;
}) {
  const label = aiStatusDisplayLabel(aiHealth?.statusLabel);
  const connected = aiHealth?.statusLabel === "connected";
  const tone = connected
    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
    : "border-amber-500/40 bg-amber-500/10 text-amber-100";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border px-5 py-3.5 text-base ${tone}`}
    >
      <div className="min-w-0">
        <span className="font-semibold">{label}</span>
        {aiHealth?.ollama.message ? (
          <span className="ml-2 text-sm opacity-85">
            {aiHealth.ollama.message}
            {aiHealth.ollama.latencyMs != null
              ? ` · ${aiHealth.ollama.latencyMs}ms`
              : ""}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        className="ui-btn shrink-0 border border-current/30 bg-black/10 text-sm disabled:opacity-50"
      >
        {busy ? "Checking…" : "Check AI"}
      </button>
    </div>
  );
}

function PreviewField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/70 bg-[var(--panel-elevated)]/50 px-3 py-2">
      <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-base leading-snug">{children}</div>
    </div>
  );
}

function SubmitPaperButton({
  previewBlockers,
  approved,
  executionEnabled,
  canSubmitGates,
  tradeBusy,
  onSubmit,
}: {
  previewBlockers: OrderGateBlocker[];
  approved: boolean;
  executionEnabled: boolean;
  canSubmitGates: boolean;
  tradeBusy: boolean;
  onSubmit: () => void;
}) {
  const explanations = collectUiBlockExplanations({
    blockers: previewBlockers,
    approved,
  });
  const btn = submitButtonState({
    explanations,
    tradeBusy,
    canSubmitGates,
    approved,
    executionEnabled,
  });
  const label =
    !tradeBusy &&
    !canSubmitGates &&
    previewBlockers.length === 0
      ? "Cannot submit — preview out of date"
      : btn.label;

  return (
    <button
      type="button"
      disabled={btn.disabled}
      onClick={onSubmit}
      className="ui-btn border border-emerald-500/50 bg-emerald-500/15 text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function selectClass() {
  return "border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-base text-[var(--foreground)] rounded-[var(--radius-sm)]";
}

export function ControlRoom({ initialData }: { initialData: DashboardData }) {
  const { viewMode, openAi, closeAi, aiOpen, aiSeed } = useUiChrome();
  const simple = viewMode === "simple";
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();
  const [aiHealthBusy, setAiHealthBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [compareSymbols, setCompareSymbols] = useState<[string | null, string | null]>([
    null,
    null,
  ]);
  const [filters, setFilters] = useState<WatchlistFilters>(
    DEFAULT_WATCHLIST_FILTERS,
  );

  const storedDefaultQty = useSyncExternalStore(
    subscribeUiSettings,
    () => loadUiSettings().defaultQuantity,
    () => 1,
  );
  const localWatchlist = useSyncExternalStore(
    subscribeUiSettings,
    getLocalWatchlistSymbols,
    () => [],
  );
  const [tradeQtyOverride, setTradeQtyOverride] = useState<number | null>(null);
  const tradeQty = tradeQtyOverride ?? storedDefaultQty;
  const setTradeQty = setTradeQtyOverride;
  const [manualSymbol, setManualSymbol] = useState(
    () => initialData.market?.market[0]?.symbol ?? "",
  );
  const [manualSide, setManualSide] = useState<"buy" | "sell">("buy");
  const [preview, setPreview] = useState<PaperOrderPreview | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [approved, setApproved] = useState(false);
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeResult, setTradeResult] = useState<PaperOrderSubmitResult | null>(
    null,
  );
  const [symbolSearch, setSymbolSearch] = useState("");
  const [symbolSearchBusy, setSymbolSearchBusy] = useState(false);
  const [symbolSearchMsg, setSymbolSearchMsg] = useState<string | null>(null);

  const {
    account,
    market,
    decisions,
    trades,
    clock,
    marketCondition,
    orderExecutionEnabled,
    aiHealth,
    decisionHistory,
    news,
  } = data;
  const error = refreshError ?? data.error;
  const currency = account?.account.currency ?? "USD";
  const marketClosed = clock ? !clock.isOpen : false;
  const executionOff = !orderExecutionEnabled;

  const viewRows: WatchlistViewRow[] = useMemo(() => {
    if (!market?.market) return [];
    return market.market.map((row) => {
      const d =
        row.decision ??
        decisions.find((x) => x.symbol === row.symbol) ??
        null;
      return {
        symbol: row.symbol,
        last: row.last,
        mid: row.mid,
        decision: d,
        blockReasons: collectRowBlockReasons(d, orderExecutionEnabled),
        tradable: rowIsTradable(d, orderExecutionEnabled),
      };
    });
  }, [market, decisions, orderExecutionEnabled]);

  const filteredRows = useMemo(
    () => filterAndSortWatchlist(viewRows, filters),
    [viewRows, filters],
  );

  const paperWatchlistSymbols = useMemo(() => {
    const fromServer = market?.watchlist ?? viewRows.map((r) => r.symbol);
    return filterUsStockSymbols([
      ...fromServer,
      ...localWatchlist,
      ...(manualSymbol ? [manualSymbol] : []),
    ]);
  }, [market?.watchlist, viewRows, localWatchlist, manualSymbol]);

  const newsBySymbol = useMemo(() => news?.bySymbol ?? {}, [news?.bySymbol]);

  function invalidatePreview(reason?: string) {
    if (preview) {
      setPreviewStale(true);
      setApproved(false);
      if (reason) setTradeError(reason);
    }
  }

  async function addSymbolFromSearch() {
    const raw = symbolSearch.trim().toUpperCase();
    if (!raw) return;
    setSymbolSearchBusy(true);
    setSymbolSearchMsg(null);
    setTradeError(null);
    try {
      const res = await fetchJson<{
        ok: boolean;
        error?: string;
        symbol?: string;
        name?: string;
        message?: string;
      }>(`/api/stocks/lookup?symbol=${encodeURIComponent(raw)}`);
      if (!res.ok || !res.symbol) {
        setSymbolSearchMsg(res.error ?? `Could not validate ${raw}`);
        return;
      }
      addLocalWatchlistSymbol(res.symbol);
      setManualSymbol(res.symbol);
      setPreview(null);
      setPreviewStale(false);
      setApproved(false);
      setSymbolSearch("");
      setSymbolSearchMsg(
        res.message ??
          `${res.symbol} added to your local watchlist preferences.`,
      );
    } catch (err) {
      setSymbolSearchMsg(
        err instanceof Error ? err.message : "Symbol lookup failed",
      );
    } finally {
      setSymbolSearchBusy(false);
    }
  }

  const buildAiContext = useCallback((): AiCommandRequest["context"] => {
    return {
      watchlist: market?.watchlist ?? [],
      marketOpen: clock?.isOpen ?? null,
      orderExecutionEnabled,
      account: account
        ? {
            equity: account.account.equity,
            cash: account.account.cash,
            buyingPower: account.account.buyingPower,
            currency: account.account.currency ?? currency,
          }
        : null,
      marketCondition: marketCondition
        ? {
            label: marketCondition.label,
            explanation: marketCondition.explanation,
            marketScore: marketCondition.marketScore,
          }
        : null,
      decisions: decisions.map((d) => ({
        symbol: d.symbol,
        action: d.action,
        confidence: d.confidence,
        riskLevel: d.riskLevel ?? d.riskStatus,
        finalScore: d.scores?.finalScore,
        technicalScore: d.scores?.technicalScore,
        marketScore: d.scores?.marketScore,
        newsScore: d.scores?.newsScore,
        riskScore: d.scores?.riskScore,
        tradeBlockReasons: d.tradeBlockReasons,
        readyForManualPaperTrade: d.readyForManualPaperTrade,
        summary: d.explanation?.summary ?? d.reasons[0],
        technicalReason: d.explanation?.technical,
        newsReason: d.explanation?.news ?? d.newsContext?.explanation,
        marketReason:
          d.explanation?.market ?? d.marketCondition?.explanation,
        riskReason: d.explanation?.risk,
      })),
      newsBySymbol: Object.fromEntries(
        Object.entries(newsBySymbol).map(([sym, n]) => [
          sym,
          {
            overallSentiment: n.overallSentiment,
            explanation: n.explanation,
            headlines: n.items?.slice(0, 3).map((i) => i.headline) ?? [],
          },
        ]),
      ),
    };
  }, [
    market?.watchlist,
    clock?.isOpen,
    orderExecutionEnabled,
    account,
    currency,
    marketCondition,
    decisions,
    newsBySymbol,
  ]);

  function toggleExpanded(symbol: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
    setSelectedSymbol(symbol);
  }

  function expandAll() {
    setExpanded(new Set(filteredRows.map((r) => r.symbol)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  function toggleCompare(symbol: string) {
    setCompareSymbols(([a, b]) => {
      if (a === symbol) return [b, null];
      if (b === symbol) return [a, null];
      if (!a) return [symbol, null];
      if (!b) return [a, symbol];
      return [b, symbol];
    });
  }

  async function prepareFromDecision(decision: AiDecision) {
    const side = actionToSide(decision.action);
    if (!side) return;
    setManualSymbol(decision.symbol);
    setManualSide(side);
    await preparePaperTrade({
      symbol: decision.symbol,
      side,
      action: decision.action,
      riskStatus: decision.riskStatus,
    });
  }

  async function preparePaperTrade(input: {
    symbol: string;
    side: "buy" | "sell";
    action: AiDecision["action"];
    riskStatus: string;
  }) {
    setTradeError(null);
    setTradeResult(null);
    setApproved(false);
    setTradeBusy(true);
    try {
      const body = await fetchJson<PaperOrderPreview>("/api/trades/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: input.symbol,
          side: input.side,
          qty: tradeQty,
          action: input.action,
          riskStatus: input.riskStatus,
        }),
      });
      setPreview(body);
      setPreviewStale(false);
      setManualSymbol(body.symbol);
      setManualSide(body.side);
      requestAnimationFrame(() => {
        document
          .getElementById("paper-trade-approval")
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (err) {
      setPreview(null);
      setPreviewStale(false);
      setTradeError(
        err instanceof Error ? err.message : "Failed to prepare paper trade",
      );
    } finally {
      setTradeBusy(false);
    }
  }

  async function prepareManual() {
    const d =
      decisions.find((x) => x.symbol === manualSymbol) ??
      null;
    const action =
      manualSide === "buy" ? ("BUY" as const) : ("SELL" as const);
    await preparePaperTrade({
      symbol: manualSymbol,
      side: manualSide,
      action: d && isPreparableAction(d.action) ? d.action : action,
      riskStatus: d?.riskStatus ?? "unknown",
    });
  }

  async function submitPaperTrade() {
    if (!preview || !approved) return;
    if (
      previewStale ||
      preview.symbol !== manualSymbol ||
      preview.side !== manualSide ||
      preview.qty !== tradeQty
    ) {
      setTradeError(
        "Preview is out of date. Click Preview paper trade so the selected symbol matches the preview.",
      );
      return;
    }
    setTradeError(null);
    setTradeBusy(true);
    try {
      const res = await fetch("/api/trades/submit-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          symbol: preview.symbol,
          side: preview.side,
          qty: preview.qty,
          action: preview.action,
          riskStatus: preview.riskStatus,
          confirmed: true,
          manualApproval: true,
        }),
      });
      const body = (await res.json()) as PaperOrderSubmitResult & {
        error?: string;
      };
      setTradeResult(body);
      if (body.preview) setPreview(body.preview);
      if (!body.submitted) {
        setTradeError(body.error ?? "Paper order was blocked");
      } else {
        setApproved(false);
        refresh();
      }
    } catch (err) {
      setTradeError(
        err instanceof Error ? err.message : "Failed to submit paper order",
      );
    } finally {
      setTradeBusy(false);
    }
  }

  async function refreshAiHealth() {
    setAiHealthBusy(true);
    try {
      const aiHealthRes = await fetchJson<AiHealthPayload>("/api/ai/health");
      setData((prev) => ({
        ...prev,
        aiHealth: aiHealthRes,
        orderExecutionEnabled:
          aiHealthRes.orderExecutionEnabled ?? prev.orderExecutionEnabled,
      }));
    } catch (err) {
      setRefreshError(
        err instanceof Error ? err.message : "Failed to check AI health",
      );
    } finally {
      setAiHealthBusy(false);
    }
  }

  function refresh() {
    setRefreshError(null);
    startTransition(() => {
      void (async () => {
        try {
          const [
            safety,
            accountRes,
            marketRes,
            decisionRes,
            historyRes,
            tradesRes,
            clockRes,
            newsRes,
            aiHealthRes,
            performanceRes,
          ] = await Promise.all([
            fetchJson<SafetyPayload>("/api/safety"),
            fetchJson<AccountPayload>("/api/account"),
            fetchJson<MarketPayload>("/api/market"),
            fetchJson<DecisionPayload>("/api/ai/decision"),
            fetchJson<{ history: DecisionHistoryEntry[] }>("/api/ai/history"),
            fetchJson<{
              trades: TradeRow[];
              orderExecutionEnabled?: boolean;
            }>("/api/trades"),
            fetchJson<{ clock: MarketClockStatus }>("/api/market/clock"),
            fetchJson<NewsPayload>("/api/news"),
            fetchJson<AiHealthPayload>("/api/ai/health"),
            fetchJson<PerformancePayload>("/api/performance"),
          ]);

          const decisionBySymbol = new Map(
            decisionRes.decisions.map((d) => [d.symbol, d]),
          );
          const clockMerged =
            clockRes.clock ?? decisionRes.clock ?? marketRes.clock ?? null;

          setData({
            ...data,
            ok: true,
            safety,
            account: accountRes,
            clock: clockMerged,
            market: {
              ...marketRes,
              clock: clockMerged,
              market: marketRes.market.map((row) => ({
                ...row,
                decision: decisionBySymbol.get(row.symbol) ?? null,
                dataQuality:
                  row.dataQuality ??
                  decisionBySymbol.get(row.symbol)?.dataQuality ??
                  null,
              })),
            },
            decisions: decisionRes.decisions,
            marketCondition: decisionRes.marketCondition ?? null,
            news: {
              provider: newsRes.provider ?? decisionRes.news?.provider ?? "mock",
              bySymbol: newsRes.bySymbol ?? decisionRes.news?.bySymbol ?? {},
              status: newsRes.status ??
                decisionRes.news?.status ?? {
                  requestedProvider: "mock",
                  activeProvider: newsRes.provider ?? "mock",
                  usedFallback: false,
                  fallbackReason: null,
                  ok: true,
                },
              aiStatus: newsRes.aiStatus ??
                decisionRes.news?.aiStatus ?? {
                  requestedProvider: "heuristic",
                  activeProvider: "heuristic",
                  usedFallback: false,
                  fallbackReason: null,
                  model: null,
                  ok: true,
                },
            },
            decisionHistory: historyRes.history,
            trades: tradesRes.trades,
            aiHealth: aiHealthRes,
            performance: {
              history: performanceRes.history ?? [],
              summary: performanceRes.summary,
            },
            error: null,
            loadedAt: new Date().toISOString(),
            orderExecutionEnabled:
              tradesRes.orderExecutionEnabled ??
              decisionRes.orderExecutionEnabled ??
              aiHealthRes.orderExecutionEnabled ??
              false,
          });
        } catch (err) {
          setRefreshError(
            err instanceof Error ? err.message : "Failed to refresh",
          );
        }
      })();
    });
  }

  const compareA = compareSymbols[0]
    ? decisions.find((d) => d.symbol === compareSymbols[0])
    : null;
  const compareB = compareSymbols[1]
    ? decisions.find((d) => d.symbol === compareSymbols[1])
    : null;

  return (
    <div className="flex flex-col gap-7">
      <DashboardSummary
        equity={account?.account.equity}
        cash={account?.account.cash}
        buyingPower={account?.account.buyingPower}
        currency={currency}
        marketOpen={clock?.isOpen ?? null}
        marketCondition={marketCondition}
        orderExecutionEnabled={orderExecutionEnabled}
        decisions={decisions}
        simple={simple}
        onAskAi={() => openAi()}
        onJumpWatchlist={() => {
          document
            .getElementById("watchlist")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PaperOnlyBanner detail="manual approval required" />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={isPending}
            className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--foreground)] disabled:opacity-50"
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </button>
          <p className="text-sm text-[var(--muted)]">
            Updated {formatTime(data.loadedAt)}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-base text-rose-100">
          {error}
        </div>
      )}

      {!simple && (
        <AiHealthBanner
          aiHealth={aiHealth}
          onRefresh={() => void refreshAiHealth()}
          busy={aiHealthBusy}
        />
      )}

      {!simple && <MarketConditionBanner condition={marketCondition} />}

      {(compareA || compareB) && !simple && (
        <Panel title="Symbol compare">
          <div className="mb-2 flex flex-wrap gap-2 text-sm">
            <span className="text-[var(--muted)]">
              Select up to two symbols with Compare on each row.
            </span>
            <button
              type="button"
              className="underline text-amber-100"
              onClick={() => setCompareSymbols([null, null])}
            >
              Clear
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 text-base">
            {[compareA, compareB].map((d, i) => (
              <div
                key={i}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/40 px-4 py-3"
              >
                {d ? (
                  <>
                    <p className="text-lg font-semibold">{d.symbol}</p>
                    <p className="mt-1">
                      {d.action} · {(d.confidence * 100).toFixed(0)}%
                    </p>
                    <p className="mt-1 text-[var(--muted)]">
                      {d.explanation?.summary ?? d.reasons[0]}
                    </p>
                  </>
                ) : (
                  <p className="text-[var(--muted)]">Slot {i + 1} empty</p>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Watchlist"
        className="scroll-mt-28"
        action={
          <span className="text-sm text-[var(--muted)]">
            {filteredRows.length} stocks
          </span>
        }
      >
        <div id="watchlist" className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={filters.query}
              onChange={(e) =>
                setFilters((f) => ({ ...f, query: e.target.value }))
              }
              placeholder="Find symbol…"
              className={`${selectClass()} w-36 rounded-[var(--radius-sm)]`}
            />
            <select
              value={filters.decision}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  decision: e.target.value as WatchlistFilters["decision"],
                }))
              }
              className={`${selectClass()} rounded-[var(--radius-sm)]`}
            >
              <option value="ALL">All decisions</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
              <option value="HOLD">HOLD</option>
            </select>
            <select
              value={filters.tradable}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  tradable: e.target.value as WatchlistFilters["tradable"],
                }))
              }
              className={`${selectClass()} rounded-[var(--radius-sm)]`}
            >
              <option value="ALL">All stocks</option>
              <option value="tradable">Ready to preview</option>
              <option value="blocked">Blocked</option>
            </select>
            {!simple && (
              <>
                <select
                  value={filters.risk}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      risk: e.target.value as WatchlistFilters["risk"],
                    }))
                  }
                  className={`${selectClass()} rounded-[var(--radius-sm)]`}
                >
                  <option value="ALL">All risk</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <select
                  value={`${filters.sortKey}:${filters.sortDir}`}
                  onChange={(e) => {
                    const [sortKey, sortDir] = e.target.value.split(":") as [
                      WatchlistFilters["sortKey"],
                      WatchlistFilters["sortDir"],
                    ];
                    setFilters((f) => ({ ...f, sortKey, sortDir }));
                  }}
                  className={`${selectClass()} rounded-[var(--radius-sm)]`}
                >
                  <option value="confidence:desc">Highest confidence</option>
                  <option value="finalScore:desc">Highest score</option>
                  <option value="symbol:asc">Symbol A–Z</option>
                </select>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={expandAll}
              className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-sm"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-sm"
            >
              Collapse all
            </button>
          </div>
        </div>

        {filteredRows.length > 0 ? (
          <ScrollTable
            minWidthClass={
              simple
                ? "min-w-[28rem] md:min-w-[36rem]"
                : "min-w-[36rem] md:min-w-[48rem]"
            }
          >
            <table className="w-full text-left text-base">
              <thead>
                <tr className="border-b border-[var(--border)] text-sm text-[var(--muted)]">
                  <th className="py-3 pr-3 font-medium">Stock</th>
                  <th className="py-3 pr-3 font-medium">Price</th>
                  {!simple && (
                    <>
                      <th className="hidden py-3 pr-3 font-medium md:table-cell">
                        Trend
                      </th>
                      <th className="hidden py-3 pr-3 font-medium sm:table-cell">
                        News
                      </th>
                    </>
                  )}
                  <th className="py-3 pr-3 font-medium">Decision</th>
                  <th className="py-3 pr-3 font-medium">
                    {simple ? "Confidence" : "Scores"}
                  </th>
                  <th className="py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const d = row.decision;
                  const isOpen = expanded.has(row.symbol);
                  const isActive = selectedSymbol === row.symbol;
                  const canPrepare = d != null && canShowPreparePaperTrade(d);
                  const rowBlockReasons = withoutGlobalBlockKinds(
                    row.blockReasons,
                    { marketClosed, executionOff },
                  );
                  const newsForSym: SymbolNewsAnalysis | null =
                    newsBySymbol[row.symbol] ?? null;
                  const hist = (decisionHistory ?? []).filter(
                    (h) => h.symbol === row.symbol,
                  );
                  const otherCompare =
                    compareSymbols[0] === row.symbol
                      ? compareB
                      : compareSymbols[1] === row.symbol
                        ? compareA
                        : compareA && compareB
                          ? null
                          : (compareA ?? compareB);
                  const colSpan = simple ? 5 : 7;

                  return (
                    <Fragment key={row.symbol}>
                      <tr
                        className={`border-b border-[var(--border)]/40 align-middle transition-colors ${
                          isOpen || isActive
                            ? "bg-[var(--panel-elevated)]/30"
                            : "hover:bg-[var(--panel-elevated)]/15"
                        }`}
                      >
                        <td className="py-3.5 pr-3">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            className="text-left text-lg font-semibold hover:text-amber-200"
                            onClick={() => toggleExpanded(row.symbol)}
                          >
                            {row.symbol}
                            <span
                              className={`ml-1.5 inline-block text-sm text-[var(--muted)] transition-transform duration-200 ${
                                isOpen ? "rotate-90" : ""
                              }`}
                            >
                              ▸
                            </span>
                          </button>
                          {!simple && (
                            <button
                              type="button"
                              onClick={() => toggleCompare(row.symbol)}
                              className={`mt-1 block text-sm ${
                                compareSymbols[0] === row.symbol ||
                                compareSymbols[1] === row.symbol
                                  ? "text-amber-200"
                                  : "text-[var(--muted)] hover:text-amber-100"
                              }`}
                            >
                              Compare
                            </button>
                          )}
                        </td>
                        <td className="py-3.5 pr-3 text-lg tabular-nums">
                          {formatNumber(row.last ?? row.mid)}
                        </td>
                        {!simple && (
                          <>
                            <td className="hidden py-3.5 pr-3 whitespace-nowrap md:table-cell">
                              {trendLabel(d)}
                            </td>
                            <td className="hidden py-3.5 pr-3 sm:table-cell">
                              <SentimentBadge
                                sentiment={d?.newsContext?.overallSentiment}
                              />
                            </td>
                          </>
                        )}
                        <td className="py-3.5 pr-3">
                          <div className="flex flex-col gap-1">
                            {d ? <ActionBadge action={d.action} /> : "—"}
                            {d?.riskLevel || d?.riskStatus ? (
                              <RiskBadge
                                status={d.riskLevel ?? d.riskStatus}
                              />
                            ) : null}
                          </div>
                        </td>
                        <td className="py-3.5 pr-3">
                          {simple ? (
                            d ? (
                              <ConfidenceBar value={d.confidence} />
                            ) : (
                              "—"
                            )
                          ) : (
                            <ScoreBadges scores={d?.scores} />
                          )}
                        </td>
                        <td className="py-3.5 max-w-[16rem]">
                          {canPrepare && d ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {executionOff && <ExecutionLockHint />}
                              <button
                                type="button"
                                disabled={tradeBusy}
                                onClick={() => void prepareFromDecision(d)}
                                className="ui-btn border border-amber-500/40 bg-amber-500/12 text-sm text-amber-50 disabled:opacity-50"
                              >
                                Prepare
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-start gap-2">
                              {executionOff && <ExecutionLockHint />}
                              <BlockReasonList
                                reasons={rowBlockReasons}
                                emptyLabel={
                                  executionOff || marketClosed
                                    ? "See summary"
                                    : "—"
                                }
                                maxVisible={simple ? 1 : 2}
                                layout="inline"
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                      {d ? (
                        <WatchlistDetailPanel
                          d={d}
                          open={isOpen}
                          allBlockReasons={row.blockReasons}
                          news={newsForSym}
                          history={hist}
                          compareWith={otherCompare}
                          simple={simple}
                          colSpan={colSpan}
                          onAskAi={() => {
                            setSelectedSymbol(row.symbol);
                            openAi(
                              `Explain ${row.symbol} in simple English`,
                            );
                          }}
                          onPrepare={() => void prepareFromDecision(d)}
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
        ) : (
          <EmptyState title="No matching stocks">
            <p>Adjust filters or refresh the watchlist.</p>
          </EmptyState>
        )}
      </Panel>

      <div id="paper-trade-approval" className="scroll-mt-24">
        <Panel title="Manual paper trade approval">
          <SafetyStrip
            orderExecutionEnabled={orderExecutionEnabled}
            compact
          />
          <PaperOnlyBanner detail="AI cannot submit · confirm required" />

          <div className="mb-5 mt-4 flex flex-col gap-4">
            <div className="grid gap-4 text-base sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
                <span className="text-sm text-[var(--muted)]">
                  Watchlist symbols
                </span>
                <select
                  value={manualSymbol}
                  onChange={(e) => {
                    const next = e.target.value;
                    setManualSymbol(next);
                    if (preview && preview.symbol !== next) {
                      setPreview(null);
                      setPreviewStale(false);
                      setApproved(false);
                      setTradeError(
                        `Symbol changed to ${next}. Click Preview paper trade again.`,
                      );
                    }
                  }}
                  className={`${selectClass()} rounded-[var(--radius-sm)]`}
                >
                  {paperWatchlistSymbols.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-[var(--muted)]">
                  Only your configured watchlist appears here. This is not the
                  full Alpaca stock universe.
                </span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-[var(--muted)]">Side</span>
                <select
                  value={manualSide}
                  onChange={(e) => {
                    const next = e.target.value as "buy" | "sell";
                    setManualSide(next);
                    if (preview && preview.side !== next) {
                      setPreview(null);
                      setPreviewStale(false);
                      setApproved(false);
                      setTradeError(
                        `Side changed to ${next.toUpperCase()}. Click Preview paper trade again.`,
                      );
                    }
                  }}
                  className={`${selectClass()} rounded-[var(--radius-sm)]`}
                >
                  <option value="buy">BUY</option>
                  <option value="sell">SELL</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-[var(--muted)]">Quantity</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={tradeQty}
                  onChange={(e) => {
                    const next = Math.max(
                      1,
                      Math.floor(Number(e.target.value) || 1),
                    );
                    setTradeQty(next);
                    if (preview && preview.qty !== next) {
                      invalidatePreview(
                        `Quantity changed to ${next}. Click Preview paper trade again.`,
                      );
                      setPreview(null);
                      setPreviewStale(false);
                    }
                  }}
                  className={`${selectClass()} rounded-[var(--radius-sm)]`}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={tradeBusy || !manualSymbol}
                  onClick={() => void prepareManual()}
                  className="ui-btn w-full border border-amber-500/40 bg-amber-500/10 text-amber-100 disabled:opacity-50"
                >
                  {tradeBusy ? "Preparing…" : "Preview paper trade"}
                </button>
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/40 px-4 py-3">
              <label className="flex flex-col gap-1.5 text-base sm:flex-row sm:items-end sm:gap-3">
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-sm text-[var(--muted)]">
                    Search stock symbol
                  </span>
                  <input
                    value={symbolSearch}
                    onChange={(e) =>
                      setSymbolSearch(e.target.value.toUpperCase())
                    }
                    placeholder="e.g. TSLA, AMD, META"
                    className={`${selectClass()} rounded-[var(--radius-sm)]`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addSymbolFromSearch();
                      }
                    }}
                  />
                </span>
                <button
                  type="button"
                  disabled={symbolSearchBusy || !symbolSearch.trim()}
                  onClick={() => void addSymbolFromSearch()}
                  className="ui-btn shrink-0 border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] disabled:opacity-50"
                >
                  {symbolSearchBusy ? "Checking…" : "Validate & add"}
                </button>
              </label>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Validates one symbol via Alpaca paper assets. Adds it to your
                local watchlist preferences only — does not load the full stock
                universe.
              </p>
              {symbolSearchMsg ? (
                <p className="mt-2 text-sm text-amber-100/90">{symbolSearchMsg}</p>
              ) : null}
            </div>
          </div>

          {executionOff && (
            <div className="mb-4 rounded-[var(--radius-sm)] border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-base text-amber-100">
              <p className="font-semibold">Order execution is OFF (default).</p>
              <p className="mt-1.5 text-sm leading-relaxed">
                Preview is allowed for review. Submit stays disabled until{" "}
                <code className="font-mono">
                  ENABLE_PAPER_ORDER_EXECUTION=true
                </code>{" "}
                in <code className="font-mono">.env.local</code>.
              </p>
            </div>
          )}

          {tradeError && (
            <p className="mb-4 rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-base text-rose-200">
              {tradeError}
            </p>
          )}

          {preview ? (
            <div className="paper-preview-enter flex flex-col gap-3 text-base">
              {(previewStale ||
                preview.symbol !== manualSymbol ||
                preview.side !== manualSide ||
                preview.qty !== tradeQty) && (
                <div className="rounded-[var(--radius-sm)] border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-50">
                  <p className="font-semibold">Preview out of date</p>
                  <p className="mt-1 text-sm leading-relaxed">
                    Selected controls are {manualSymbol} {manualSide.toUpperCase()}{" "}
                    × {tradeQty}, but this preview is for {preview.symbol}{" "}
                    {preview.side.toUpperCase()} × {preview.qty}. Click{" "}
                    <strong>Preview paper trade</strong> again so they match.
                  </p>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <PreviewField label="Preview symbol">
                  <div className="font-semibold">
                    {preview.symbol}
                    {preview.symbol === manualSymbol ? (
                      <span className="ml-2 text-xs font-medium text-emerald-300">
                        matches selection
                      </span>
                    ) : (
                      <span className="ml-2 text-xs font-medium text-amber-200">
                        ≠ selected {manualSymbol}
                      </span>
                    )}
                  </div>
                </PreviewField>
                <PreviewField label="Side">
                  <ActionBadge action={preview.side} />
                </PreviewField>
                <PreviewField label="Quantity">
                  <div className="tabular-nums font-semibold">
                    {preview.qty}
                  </div>
                </PreviewField>
                <PreviewField label="Order type">
                  <div className="uppercase">
                    {preview.orderType} / {preview.timeInForce}
                  </div>
                </PreviewField>
                <PreviewField label="Est. price">
                  <div className="tabular-nums">
                    {formatMoney(preview.estimatedPrice, currency)}
                  </div>
                </PreviewField>
                <PreviewField label="Est. notional">
                  <div className="tabular-nums">
                    {formatMoney(preview.estimatedNotional, currency)}
                    <span className="ml-1 text-sm text-[var(--muted)]">
                      (max {formatMoney(preview.maxNotional, currency)})
                    </span>
                  </div>
                </PreviewField>
              </div>

              <PaperTradeBlockPanel
                blockers={preview.gates.blockers}
                approved={approved}
                executionEnabled={preview.executionEnabled}
              />

              <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/40 px-4 py-4 text-base">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span>
                  I understand this is a <strong>PAPER TRADE ONLY</strong> and I
                  manually approve submitting this market order. This is not
                  one-click or automatic trading.
                </span>
              </label>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <SubmitPaperButton
                  previewBlockers={preview.gates.blockers}
                  approved={approved}
                  executionEnabled={preview.executionEnabled}
                  canSubmitGates={
                    preview.gates.blockers.length === 0 &&
                    !previewStale &&
                    preview.symbol === manualSymbol &&
                    preview.side === manualSide &&
                    preview.qty === tradeQty
                  }
                  tradeBusy={tradeBusy}
                  onSubmit={() => void submitPaperTrade()}
                />
                <button
                  type="button"
                  disabled={tradeBusy}
                  onClick={() => {
                    setPreview(null);
                    setPreviewStale(false);
                    setApproved(false);
                    setTradeResult(null);
                    setTradeError(null);
                  }}
                  className="ui-btn border border-[var(--border)] text-[var(--muted)]"
                >
                  Cancel preview
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] bg-[var(--panel-elevated)]/30 px-4 py-5 text-base text-[var(--muted)]">
              Choose symbol / side / qty above, or use Prepare on a watchlist
              row. Submit stays disabled until confirmation and all safety gates
              pass.
            </div>
          )}

          {tradeResult?.submitted && tradeResult.order && (
            <div className="mt-5 rounded-[var(--radius-sm)] border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 text-base">
              <p className="font-semibold text-emerald-200">
                Paper order submitted
              </p>
              <p className="mt-1.5 text-sm text-emerald-100/90">
                {tradeResult.order.side.toUpperCase()} {tradeResult.order.qty}{" "}
                {tradeResult.order.symbol} · {tradeResult.order.status}
              </p>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Recent paper orders">
        {trades.length > 0 ? (
          <ScrollTable minWidthClass="min-w-[28rem] sm:min-w-[36rem]">
            <table className="w-full text-left text-base">
              <thead>
                <tr className="border-b border-[var(--border)] text-sm text-[var(--muted)]">
                  <th className="py-3 pr-3 font-medium">Time</th>
                  <th className="py-3 pr-3 font-medium">Symbol</th>
                  <th className="py-3 pr-3 font-medium">Side</th>
                  <th className="py-3 pr-3 font-medium">Qty</th>
                  <th className="py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 10).map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--border)]/50"
                  >
                    <td className="py-3 pr-3 text-[var(--muted)]">
                      {formatTime(t.filledAt ?? t.submittedAt)}
                    </td>
                    <td className="py-3 pr-3 text-lg font-semibold">
                      {t.symbol}
                    </td>
                    <td className="py-3 pr-3">
                      <ActionBadge action={t.side} />
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {t.filledQty || t.qty || "—"}
                    </td>
                    <td className="py-3 text-[var(--muted)]">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        ) : (
          <EmptyState title="No paper orders yet">
            <p>
              Approved paper trades will appear here after manual confirmation.
            </p>
          </EmptyState>
        )}
      </Panel>

      <AiCommandCenter
        key={aiSeed ?? "ai-command"}
        open={aiOpen}
        onClose={closeAi}
        orderExecutionEnabled={orderExecutionEnabled}
        selectedSymbol={selectedSymbol}
        buildContext={buildAiContext}
        seedInstruction={aiSeed}
        onSelectSymbol={(sym) => {
          setSelectedSymbol(sym);
          setExpanded((prev) => new Set(prev).add(sym));
        }}
        onPreparePreview={(symbol, side) => {
          closeAi();
          setManualSymbol(symbol);
          setManualSide(side);
          const d = decisions.find((x) => x.symbol === symbol);
          void preparePaperTrade({
            symbol,
            side,
            action: side === "buy" ? "BUY" : "SELL",
            riskStatus: d?.riskStatus ?? "unknown",
          });
        }}
      />
    </div>
  );
}
