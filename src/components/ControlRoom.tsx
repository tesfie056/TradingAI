"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { ActionBadge, ExecutionLockHint } from "@/components/ui/badges";
import {
  ReadinessBadge,
  readinessFromSignals,
} from "@/components/ui/ReadinessBadge";
import { AdvancedDetails } from "@/components/ui/AdvancedDetails";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { DashboardOverview } from "@/components/control-room/DashboardOverview";
import { OpenPositionsPanel } from "@/components/control-room/OpenPositionsPanel";
import { WatchlistDetailPanel } from "@/components/control-room/WatchlistDetailPanel";
import { PaperTradeBlockPanel } from "@/components/trades/PaperTradeBlockPanel";
import { PaperOrdersTable } from "@/components/trades/PaperOrdersTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUiChrome } from "@/components/layout/UiChromeContext";
import { useOptionalStockWorkspace } from "@/components/stock/StockWorkspaceContext";
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
import {
  addLocalWatchlistSymbol,
  getDefaultNotionalServerSnapshot,
  getDefaultNotionalSnapshot,
  getDefaultQuantityServerSnapshot,
  getDefaultQuantitySnapshot,
  getLocalWatchlistSymbolsServerSnapshot,
  getLocalWatchlistSymbolsSnapshot,
  getOrderModeServerSnapshot,
  getOrderModeSnapshot,
  subscribeUiSettings,
  type UiOrderMode,
} from "@/lib/client/ui-settings";
import type { OrderMode } from "@/lib/config";
import type { SymbolNewsAnalysis } from "@/lib/news/types";
import { filterUsStockSymbols } from "@/lib/stocks/universe";

function previewMatchesSelection(
  preview: PaperOrderPreview,
  manualSymbol: string,
  manualSide: "buy" | "sell",
  orderMode: OrderMode,
  tradeQty: number,
  tradeNotional: number,
): boolean {
  if (preview.symbol !== manualSymbol || preview.side !== manualSide) {
    return false;
  }
  if (preview.orderMode !== orderMode) return false;
  if (orderMode === "notional") {
    return preview.notional === tradeNotional;
  }
  return preview.qty === tradeQty;
}

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

export type ControlRoomPage = "dashboard" | "watchlist" | "trade";

export function ControlRoom({
  initialData,
  page = "dashboard",
}: {
  initialData: DashboardData;
  page?: ControlRoomPage;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { viewMode } = useUiChrome();
  const stockWorkspace = useOptionalStockWorkspace();
  const simple = viewMode === "simple";
  const tradeParamsApplied = useRef(false);
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
    getDefaultQuantitySnapshot,
    getDefaultQuantityServerSnapshot,
  );
  const storedOrderMode = useSyncExternalStore(
    subscribeUiSettings,
    getOrderModeSnapshot,
    getOrderModeServerSnapshot,
  );
  const storedDefaultNotional = useSyncExternalStore(
    subscribeUiSettings,
    getDefaultNotionalSnapshot,
    getDefaultNotionalServerSnapshot,
  );
  const localWatchlist = useSyncExternalStore(
    subscribeUiSettings,
    getLocalWatchlistSymbolsSnapshot,
    getLocalWatchlistSymbolsServerSnapshot,
  );
  const [tradeQtyOverride, setTradeQtyOverride] = useState<number | null>(null);
  const [orderModeOverride, setOrderModeOverride] = useState<UiOrderMode | null>(
    null,
  );
  const [tradeNotionalOverride, setTradeNotionalOverride] = useState<
    number | null
  >(null);
  const tradeQty = tradeQtyOverride ?? storedDefaultQty;
  const orderMode = orderModeOverride ?? storedOrderMode;
  const tradeNotional = tradeNotionalOverride ?? storedDefaultNotional;
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
  const [candidateResult, setCandidateResult] = useState<{
    eligible: boolean;
    reasons: string[];
    warnings: string[];
    price: number | null;
    spreadPercent: number | null;
    avgDailyVolume: number | null;
    exchange: string | null;
  } | null>(null);

  const smallAccount = data.smallAccount;
  const smallAccountMaxNotional = smallAccount?.maxNotionalPerTrade ?? 25;
  const notionalAboveSmallAccountCap =
    smallAccount?.enabled &&
    orderMode === "notional" &&
    tradeNotional > smallAccountMaxNotional;

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

  async function addSymbolFromSearch(validateSmallAccount = false) {
    const raw = symbolSearch.trim().toUpperCase();
    if (!raw) return;
    setSymbolSearchBusy(true);
    setSymbolSearchMsg(null);
    setCandidateResult(null);
    setTradeError(null);
    try {
      if (validateSmallAccount && smallAccount?.enabled) {
        const ui = await import("@/lib/client/ui-settings").then((m) =>
          m.loadUiSettings(),
        );
        const cand = await fetchJson<{
          ok: boolean;
          candidate?: {
            eligible: boolean;
            reasons: string[];
            warnings: string[];
            price: number | null;
            spreadPercent: number | null;
            avgDailyVolume: number | null;
            exchange: string | null;
          };
          error?: string;
        }>(
          `/api/stocks/candidates?symbol=${encodeURIComponent(raw)}&maxPrice=${ui.smallAccountMaxPrice}&minVolume=${ui.smallAccountMinVolume}&maxSpread=${ui.smallAccountMaxSpread}&avoidOtc=${ui.smallAccountAvoidOtc}&majorOnly=${ui.smallAccountMajorOnly}`,
        );
        if (cand.candidate) setCandidateResult(cand.candidate);
        if (!cand.ok || !cand.candidate?.eligible) {
          setSymbolSearchMsg(
            cand.candidate?.reasons.join(" ") ??
              cand.error ??
              `${raw} did not pass small-account filters.`,
          );
          return;
        }
      }

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

  function navigatePrepare(decision: AiDecision) {
    const side = actionToSide(decision.action);
    if (!side) return;
    const params = new URLSearchParams({
      symbol: decision.symbol,
      side,
      orderMode,
    });
    if (orderMode === "notional") {
      params.set("notional", String(tradeNotional));
    } else {
      params.set("qty", String(tradeQty));
    }
    router.push(`/trade?${params}`);
  }

  function buildOrderBody(input: {
    symbol: string;
    side: "buy" | "sell";
    action: AiDecision["action"];
    riskStatus: string;
    qty?: number;
    notional?: number;
  }) {
    const mode = orderMode;
    return {
      symbol: input.symbol,
      side: input.side,
      orderMode: mode,
      ...(mode === "notional"
        ? { notional: input.notional ?? tradeNotional }
        : { qty: input.qty ?? tradeQty }),
      action: input.action,
      riskStatus: input.riskStatus,
    };
  }

  async function preparePaperTrade(input: {
    symbol: string;
    side: "buy" | "sell";
    action: AiDecision["action"];
    riskStatus: string;
    qty?: number;
    notional?: number;
  }) {
    setTradeError(null);
    setTradeResult(null);
    setApproved(false);
    setTradeBusy(true);
    try {
      const body = await fetchJson<PaperOrderPreview>("/api/trades/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOrderBody(input)),
      });
      setPreview(body);
      setPreviewStale(false);
      setManualSymbol(body.symbol);
      setManualSide(body.side);
      if (input.qty != null) setTradeQty(body.qty);
      if (input.notional != null) setTradeNotionalOverride(input.notional);
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

  useEffect(() => {
    if (page !== "trade" || tradeParamsApplied.current) return;
    const symbol = searchParams.get("symbol")?.trim().toUpperCase();
    const sideRaw = searchParams.get("side")?.toLowerCase();
    const qtyRaw = searchParams.get("qty");
    const notionalRaw = searchParams.get("notional");
    const orderModeRaw = searchParams.get("orderMode");
    if (!symbol && sideRaw == null && qtyRaw == null && notionalRaw == null) {
      return;
    }
    tradeParamsApplied.current = true;

    const side: "buy" | "sell" =
      sideRaw === "sell" ? "sell" : "buy";
    const qty = qtyRaw
      ? Math.max(1, Math.floor(Number(qtyRaw) || 1))
      : tradeQty;
    const notional = notionalRaw
      ? Math.max(1, Number(notionalRaw) || tradeNotional)
      : tradeNotional;
    const urlOrderMode: OrderMode =
      orderModeRaw === "notional" || notionalRaw != null
        ? "notional"
        : "quantity";

    const timer = window.setTimeout(() => {
      if (symbol) setManualSymbol(symbol);
      if (sideRaw === "buy" || sideRaw === "sell") setManualSide(side);
      setOrderModeOverride(urlOrderMode);
      if (qtyRaw) setTradeQty(qty);
      if (notionalRaw) setTradeNotionalOverride(notional);

      if (symbol) {
        const d = decisions.find((x) => x.symbol === symbol) ?? null;
        const action =
          side === "buy" ? ("BUY" as const) : ("SELL" as const);
        void preparePaperTrade({
          symbol,
          side,
          action: d && isPreparableAction(d.action) ? d.action : action,
          riskStatus: d?.riskStatus ?? "unknown",
          qty: urlOrderMode === "quantity" ? qty : undefined,
          notional: urlOrderMode === "notional" ? notional : undefined,
        });
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // Apply URL params once on trade page mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, searchParams]);

  async function submitPaperTrade() {
    if (!preview || !approved) return;
    if (
      previewStale ||
      !previewMatchesSelection(
        preview,
        manualSymbol,
        manualSide,
        orderMode,
        tradeQty,
        tradeNotional,
      )
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
          orderMode: preview.orderMode,
          ...(preview.orderMode === "notional"
            ? { notional: preview.notional }
            : { qty: preview.qty }),
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
      {page === "dashboard" ? (
        <DashboardOverview
          account={account}
          currency={currency}
          clock={clock}
          marketCondition={marketCondition}
          orderExecutionEnabled={orderExecutionEnabled}
          decisions={decisions}
          aiHealth={aiHealth}
          simple={simple}
          loadedAt={data.loadedAt}
          error={error}
          refresh={refresh}
          isPending={isPending}
          refreshAiHealth={() => void refreshAiHealth()}
          aiHealthBusy={aiHealthBusy}
        />
      ) : null}

      {page === "watchlist" ? (
        <>
          <PageHeader
            title="Watchlist"
            description="Search monitored stocks, filter readiness, and open a stock to trade."
            actions={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/dashboard")}
                  className="ui-btn border border-amber-500/40 bg-amber-500/12 text-amber-50"
                >
                  Add stock
                </button>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={isPending}
                  className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--foreground)] disabled:opacity-50"
                >
                  {isPending ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            }
          />

          {error && (
            <div className="rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-base text-rose-100">
              {error}
            </div>
          )}

      <Panel title="Watchlist tools" className="scroll-mt-28">
        <div id="watchlist" className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={filters.query}
              onChange={(e) =>
                setFilters((f) => ({ ...f, query: e.target.value }))
              }
              placeholder="Search within watchlist…"
              className={`${selectClass()} w-44 rounded-[var(--radius-sm)]`}
            />
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
              <option value="ALL">All readiness</option>
              <option value="tradable">Ready</option>
              <option value="blocked">Waiting / blocked</option>
            </select>
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
            {!simple ? (
              <details className="relative">
                <summary className="ui-btn cursor-pointer list-none border border-[var(--border)] bg-[var(--panel-elevated)] text-sm">
                  More
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
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
              </details>
            ) : null}
          </div>
        </div>

        {filteredRows.length > 0 ? (
          <ScrollTable minWidthClass="min-w-[28rem] md:min-w-[40rem]">
            <table className="w-full text-left text-base">
              <thead>
                <tr className="border-b border-[var(--border)] text-sm text-[var(--muted)]">
                  <th className="py-3 pr-3 font-medium">Stock</th>
                  <th className="py-3 pr-3 font-medium">Price</th>
                  <th className="py-3 pr-3 font-medium">State</th>
                  <th className="py-3 pr-3 font-medium">Readiness</th>
                  <th className="py-3 font-medium">Open</th>
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
                  const readiness = readinessFromSignals({
                    ready: canPrepare,
                    marketClosed,
                    executionOff,
                    blockReasons: rowBlockReasons,
                    action: d?.action ?? null,
                  });
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
                  const colSpan = 5;
                  const statusLabel =
                    d == null
                      ? "Waiting"
                      : d.action === "BUY"
                        ? "Ready"
                        : d.action === "SELL"
                          ? "Sell signal"
                          : "Hold";

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
                            className="text-left text-lg font-semibold hover:text-amber-200"
                            onClick={() => {
                              if (stockWorkspace) {
                                stockWorkspace.openStock(row.symbol);
                              } else {
                                toggleExpanded(row.symbol);
                              }
                            }}
                          >
                            {row.symbol}
                          </button>
                        </td>
                        <td className="py-3.5 pr-3 text-lg tabular-nums">
                          {row.last != null || row.mid != null
                            ? formatNumber(row.last ?? row.mid)
                            : "Price unavailable"}
                        </td>
                        <td className="py-3.5 pr-3">
                          <p className="text-sm font-medium text-zinc-100">
                            {statusLabel}
                          </p>
                        </td>
                        <td className="py-3.5 pr-3 max-w-[14rem]">
                          {canPrepare && d ? (
                            <div className="flex flex-col gap-1.5">
                              <ReadinessBadge kind="ready" />
                              {executionOff ? <ExecutionLockHint /> : null}
                            </div>
                          ) : (
                            <ReadinessBadge
                              kind={readiness.kind}
                              detail={readiness.detail}
                            />
                          )}
                        </td>
                        <td className="py-3.5">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="ui-btn border border-amber-500/40 bg-amber-500/12 px-2.5 py-1 text-xs text-amber-50"
                              onClick={() =>
                                stockWorkspace?.openStock(row.symbol)
                              }
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="ui-btn border border-[var(--border)] px-2.5 py-1 text-xs"
                              aria-expanded={isOpen}
                              onClick={() => toggleExpanded(row.symbol)}
                            >
                              {isOpen ? "Hide" : "Why"}
                            </button>
                          </div>
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
                          whyWaiting={readiness.whyWaiting}
                          onAskAi={() => {
                            setSelectedSymbol(row.symbol);
                            router.push("/assistant");
                          }}
                          onPrepare={() => navigatePrepare(d)}
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

          {!simple ? (
            <AdvancedDetails
              title="Advanced watchlist tools"
              summary="AI health, market condition, and symbol compare."
            >
              <div className="space-y-4">
                <AiHealthBanner
                  aiHealth={aiHealth}
                  onRefresh={() => void refreshAiHealth()}
                  busy={aiHealthBusy}
                />
                <MarketConditionBanner condition={marketCondition} />
                {(compareA || compareB) && (
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
                            <p className="text-[var(--muted)]">
                              Slot {i + 1} empty
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
              </div>
            </AdvancedDetails>
          ) : null}
        </>
      ) : null}

      {page === "trade" ? (
        <>
          <PageHeader
            title="Positions"
            description="Manage open paper positions and review recent orders."
            actions={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/dashboard")}
                  className="ui-btn border border-amber-500/40 bg-amber-500/12 text-amber-50"
                >
                  Open stock search
                </button>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={isPending}
                  className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--foreground)] disabled:opacity-50"
                >
                  {isPending ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            }
          />

          {error && (
            <div className="rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-base text-rose-100">
              {error}
            </div>
          )}

          <OpenPositionsPanel currency={currency} />

      <ExpandableSection
        title="More actions"
        tip={
          <InfoTip text="Optional tools. Prefer stock search on Overview for finding and trading symbols." />
        }
        summary="Manual paper trade and other secondary tools."
        expandLabel="Show more actions"
        collapseLabel="Hide more actions"
      >
      <ExpandableSection
        title="Manual paper trade"
        tip={
          <InfoTip text="Optional manual paper order — separate from auto trading. You must approve every submit." />
        }
        summary="Preview and approve a paper order yourself."
        expandLabel="Open manual trade"
        collapseLabel="Hide manual trade"
      >
      <div id="paper-trade-approval" className="scroll-mt-24">
        <div className="mb-4 rounded-[var(--radius-sm)] border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-50">
          Paper only · you must approve · AI cannot submit
          <InfoTip text="This form only creates paper orders after you preview and confirm. Live trading stays blocked." />
        </div>

          {smallAccount?.enabled ? (
            <div className="mb-4 mt-4 rounded-[var(--radius-sm)] border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
              <p className="font-semibold">Small Account Mode</p>
              <p className="mt-1 leading-relaxed">
                Use <strong>Dollar amount</strong> for fractional paper orders
                (default ${smallAccount.defaultNotionalAmount}, max $
                {smallAccount.maxNotionalPerTrade} per trade). Stocks $
                {smallAccount.minStockPrice}–${smallAccount.maxStockPrice} with
                liquidity filters.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100/90">
                {smallAccount.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

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
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-[var(--muted)]">Order sizing</span>
                <select
                  value={orderMode}
                  onChange={(e) => {
                    const next = e.target.value as UiOrderMode;
                    setOrderModeOverride(next);
                    invalidatePreview(
                      `Order mode changed to ${next}. Click Preview paper trade again.`,
                    );
                    setPreview(null);
                    setPreviewStale(false);
                  }}
                  className={`${selectClass()} rounded-[var(--radius-sm)]`}
                >
                  <option value="quantity">Shares (quantity)</option>
                  <option value="notional">Dollar amount (notional)</option>
                </select>
              </label>
              {orderMode === "quantity" ? (
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
              ) : (
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-sm text-[var(--muted)]">
                    Dollar amount
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={0.01}
                    value={tradeNotional}
                    onChange={(e) => {
                      const next = Math.max(1, Number(e.target.value) || 1);
                      setTradeNotionalOverride(next);
                      if (preview && preview.notional !== next) {
                        invalidatePreview(
                          `Dollar amount changed to $${next}. Click Preview paper trade again.`,
                        );
                        setPreview(null);
                        setPreviewStale(false);
                      }
                    }}
                    className={`${selectClass()} rounded-[var(--radius-sm)]`}
                  />
                  <span className="text-xs text-amber-100/90">
                    {manualSymbol
                      ? `${manualSide === "buy" ? "Buy" : "Sell"} approximately $${tradeNotional.toFixed(2)} of ${manualSymbol}`
                      : "Select a symbol to preview dollar sizing"}
                  </span>
                  {notionalAboveSmallAccountCap ? (
                    <span className="text-xs text-rose-200">
                      This is above your small-account trade size (max $
                      {smallAccountMaxNotional}).
                    </span>
                  ) : null}
                </label>
              )}
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
              <p className="text-sm font-semibold text-[var(--foreground)]">
                Small-stock watchlist builder
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Search one symbol at a time. With Small Account Mode, validates
                price, volume, spread, and exchange before suggesting as a
                candidate. Does not load the full stock universe.
              </p>
              <label className="mt-3 flex flex-col gap-1.5 text-base sm:flex-row sm:items-end sm:gap-3">
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
                  onClick={() => void addSymbolFromSearch(false)}
                  className="ui-btn shrink-0 border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] disabled:opacity-50"
                >
                  {symbolSearchBusy ? "Checking…" : "Validate & add"}
                </button>
                {smallAccount?.enabled ? (
                  <button
                    type="button"
                    disabled={symbolSearchBusy || !symbolSearch.trim()}
                    onClick={() => void addSymbolFromSearch(true)}
                    className="ui-btn shrink-0 border border-amber-500/40 bg-amber-500/10 text-amber-50 disabled:opacity-50"
                  >
                    {symbolSearchBusy ? "Checking…" : "Check candidate"}
                  </button>
                ) : null}
              </label>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Validates one symbol via Alpaca paper assets. Adds it to your
                local watchlist preferences only.
              </p>
              {candidateResult ? (
                <div
                  className={`mt-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm ${
                    candidateResult.eligible
                      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
                      : "border-amber-500/35 bg-amber-500/10 text-amber-50"
                  }`}
                >
                  <p className="font-medium">
                    {candidateResult.eligible
                      ? "Candidate passed filters"
                      : "Candidate did not pass filters"}
                  </p>
                  {candidateResult.price != null ? (
                    <p className="mt-1 text-xs">
                      Price ${candidateResult.price.toFixed(2)}
                      {candidateResult.spreadPercent != null
                        ? ` · spread ${(candidateResult.spreadPercent * 100).toFixed(2)}%`
                        : ""}
                      {candidateResult.avgDailyVolume != null
                        ? ` · avg vol ${Math.round(candidateResult.avgDailyVolume).toLocaleString()}`
                        : ""}
                      {candidateResult.exchange
                        ? ` · ${candidateResult.exchange}`
                        : ""}
                    </p>
                  ) : null}
                  {candidateResult.reasons.length > 0 ? (
                    <p className="mt-1 text-xs">{candidateResult.reasons.join(" ")}</p>
                  ) : null}
                </div>
              ) : null}
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
                !previewMatchesSelection(
                  preview,
                  manualSymbol,
                  manualSide,
                  orderMode,
                  tradeQty,
                  tradeNotional,
                )) && (
                <div className="rounded-[var(--radius-sm)] border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-50">
                  <p className="font-semibold">Preview out of date</p>
                  <p className="mt-1 text-sm leading-relaxed">
                    Selected controls are {manualSymbol} {manualSide.toUpperCase()}
                    {orderMode === "notional"
                      ? ` · $${tradeNotional}`
                      : ` × ${tradeQty}`}
                    , but this preview is for {preview.symbol}{" "}
                    {preview.side.toUpperCase()}
                    {preview.orderMode === "notional"
                      ? ` · $${preview.notional ?? "—"}`
                      : ` × ${preview.qty}`}
                    . Click <strong>Preview paper trade</strong> again so they
                    match.
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
                {preview.orderMode === "notional" ? (
                  <>
                    <PreviewField label="Dollar amount">
                      <div className="tabular-nums font-semibold">
                        {formatMoney(preview.notional, currency)}
                      </div>
                    </PreviewField>
                    <PreviewField label="Estimated shares">
                      <div className="tabular-nums font-semibold">
                        {preview.estimatedShares != null
                          ? `~${preview.estimatedShares.toFixed(4)}`
                          : "—"}
                      </div>
                    </PreviewField>
                    <PreviewField label="Estimated price">
                      <div className="tabular-nums">
                        {formatMoney(preview.estimatedPrice, currency)}
                      </div>
                    </PreviewField>
                    <PreviewField label="Estimated total">
                      <div className="tabular-nums font-semibold">
                        {formatMoney(preview.estimatedNotional, currency)}
                        <span className="ml-1 text-sm font-normal text-[var(--muted)]">
                          (max {formatMoney(preview.maxNotional, currency)})
                        </span>
                      </div>
                    </PreviewField>
                    {preview.notional != null &&
                    smallAccount?.enabled &&
                    preview.notional > smallAccountMaxNotional ? (
                      <div className="sm:col-span-2 lg:col-span-3 rounded-[var(--radius-sm)] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
                        This is above your small-account trade size.
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <PreviewField label="Quantity (shares)">
                      <div className="tabular-nums font-semibold">
                        {preview.qty}
                      </div>
                    </PreviewField>
                    <PreviewField label="Estimated price">
                      <div className="tabular-nums">
                        {formatMoney(preview.estimatedPrice, currency)}
                      </div>
                    </PreviewField>
                    <PreviewField label="Estimated total">
                      <div className="tabular-nums font-semibold">
                        {formatMoney(preview.estimatedNotional, currency)}
                        <span className="ml-1 text-sm font-normal text-[var(--muted)]">
                          (max {formatMoney(preview.maxNotional, currency)})
                        </span>
                      </div>
                    </PreviewField>
                  </>
                )}
                <PreviewField label="Order type">
                  <div className="uppercase">
                    {preview.orderType} / {preview.timeInForce}
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
                    previewMatchesSelection(
                      preview,
                      manualSymbol,
                      manualSide,
                      orderMode,
                      tradeQty,
                      tradeNotional,
                    )
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
                {tradeResult.order.side.toUpperCase()}{" "}
                {tradeResult.preview.orderMode === "notional" ? (
                  <>
                    {formatMoney(tradeResult.preview.notional, currency)} of{" "}
                    {tradeResult.order.symbol}
                    {tradeResult.order.qty
                      ? ` · ~${tradeResult.order.qty} shares`
                      : tradeResult.preview.estimatedShares != null
                        ? ` · ~${tradeResult.preview.estimatedShares.toFixed(4)} shares`
                        : ""}
                  </>
                ) : (
                  <>
                    {tradeResult.order.qty} {tradeResult.order.symbol}
                  </>
                )}{" "}
                · {tradeResult.order.status}
              </p>
            </div>
          )}
      </div>
      </ExpandableSection>
      </ExpandableSection>

      <ExpandableSection
        title="Recent paper orders"
        tip={
          <InfoTip text="Your latest manually approved paper orders from this desk." />
        }
        summary={
          trades.length > 0
            ? `${trades.length} orders available`
            : "No paper orders yet."
        }
        expandLabel="View orders"
        collapseLabel="Hide orders"
      >
        {trades.length > 0 ? (
          <PaperOrdersTable trades={trades} limit={10} />
        ) : (
          <EmptyState title="No paper orders yet">
            <p>
              Approved paper trades will appear here after manual confirmation.
            </p>
          </EmptyState>
        )}
      </ExpandableSection>
        </>
      ) : null}
    </div>
  );
}
