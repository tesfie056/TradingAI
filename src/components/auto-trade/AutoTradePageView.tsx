"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMonitorStream } from "@/components/layout/MonitorStreamContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchJson } from "@/lib/client/fetch-json";
import type { TradeRow } from "@/lib/dashboard-types";
import type { AutoTradeStatus } from "@/lib/auto-trade/types";
import { buildOperatorBlockers } from "@/lib/auto-trade/operator-blockers";
import { resolvePrimaryStatus } from "@/lib/auto-trade/primary-status";
import { TradingSettingsDrawer } from "@/components/auto-trade/TradingSettingsDrawer";
import {
  AutoTradeControlsPanel,
  AutoTradeEmergencyControls,
} from "@/components/auto-trade/AutoTradeControlsPanel";
import { AutoTradeStatusHeader } from "@/components/auto-trade/AutoTradeStatusHeader";
import { AutoTradeOverviewCard } from "@/components/auto-trade/AutoTradeOverviewCard";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { V1DailyProgressPanel } from "@/components/auto-trade/V1DailyProgressPanel";
import { V1ManagedTradeCard } from "@/components/auto-trade/V1ManagedTradeCard";
import { ExternalPositionsWarning } from "@/components/auto-trade/ExternalPositionsWarning";
import { LatestStrategyDecisionCard } from "@/components/auto-trade/LatestStrategyDecisionCard";
import { TradingBlockersPanel } from "@/components/auto-trade/TradingBlockersPanel";
import { V1UniversePanel } from "@/components/auto-trade/V1UniversePanel";
import {
  RecentAutoTradeActivity,
  buildRecentActivity,
} from "@/components/auto-trade/RecentAutoTradeActivity";
import { AdvancedAutoTradeDetails } from "@/components/auto-trade/AdvancedAutoTradeDetails";

type AutoTradeApi = AutoTradeStatus & {
  ok?: boolean;
  message?: string;
  error?: string;
  emergency?: { message?: string; openPositionsPreserved?: number };
};

const STALE_MS = 120_000;

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function AutoTradePageView() {
  const stream = useMonitorStream();
  const [status, setStatus] = useState<AutoTradeApi | null>(null);
  const [orders, setOrders] = useState<TradeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [hasBuy, setHasBuy] = useState<boolean | null>(null);
  const [needsIntervention, setNeedsIntervention] = useState(false);
  const [managedSymbols, setManagedSymbols] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const [next, trades, lifecycle] = await Promise.all([
        fetchJson<AutoTradeApi>("/api/auto-trade"),
        fetchJson<{ trades?: TradeRow[] }>("/api/trades").catch(() => ({
          trades: [],
        })),
        fetchJson<{ active?: { symbol: string }[] }>(
          "/api/auto-trade/v1-lifecycle",
        ).catch(() => ({ active: [] })),
      ]);
      setStatus(next);
      setOrders(trades.trades ?? []);
      setManagedSymbols((lifecycle.active ?? []).map((t) => t.symbol));
      setError(next.error ?? null);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load auto trade");
    }
  }, []);

  const lastScanRef = useRef<string | null>(null);

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

  useEffect(() => {
    const last = stream.status?.lastScanAt;
    if (!last || last === lastScanRef.current) return;
    lastScanRef.current = last;
    const id = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(id);
  }, [stream.status?.lastScanAt, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function postAction(
    path: string,
    body?: object,
  ): Promise<{ ok: boolean; error?: string; message?: string }> {
    if (busy) return { ok: false, error: "Another action is in progress" };
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetchJson<AutoTradeApi>(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.error || res.ok === false) {
        const msg = res.error ?? res.message ?? "Action failed";
        setError(msg);
        return { ok: false, error: msg, message: res.message };
      }
      setFeedback(res.message ?? "Action succeeded");
      if ("engine" in res || "effectivelyEnabled" in res) {
        setStatus((prev) => ({ ...(prev ?? ({} as AutoTradeApi)), ...res }));
      }
      await refresh();
      return { ok: true, message: res.message ?? "Action succeeded" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }

  const t = status?.trader;
  const engine = status?.engine;
  const autoOn = engine?.autoTradingEnabled ?? status?.envEnabled ?? false;
  const executionOn =
    engine?.executionEnabled ?? status?.executionEnabled ?? false;
  const staleUpdate =
    lastUpdatedAt != null && now - new Date(lastUpdatedAt).getTime() > STALE_MS;

  const hasLegacyConflict = (t?.openPositions ?? []).some(
    (p) => p.symbol.toUpperCase() === "AAPL" && p.qty < 0,
  );

  const blockerSummary = useMemo(() => {
    if (!status) return null;
    return buildOperatorBlockers({
      status,
      marketOpen: t?.marketOpen,
      alpacaConnected: t?.alpacaConnected ?? false,
      dataFreshness: t?.universe?.dataFreshness,
      eligibleCount: t?.universe?.eligibleCount,
      reconciliationComplete: t?.reconciliationComplete ?? false,
      hasLegacyConflict,
      hasManualIntervention: needsIntervention,
      hasQualifiedBuy: hasBuy,
      consecutiveLossPause: (t?.consecutiveLosses ?? 0) >= 3,
      dailyLossLimitHit:
        t?.dailyLossLimitUsagePct != null && t.dailyLossLimitUsagePct >= 100,
      updatedAt: lastUpdatedAt,
    });
  }, [
    status,
    t,
    hasLegacyConflict,
    needsIntervention,
    hasBuy,
    lastUpdatedAt,
  ]);

  const activity = useMemo(
    () =>
      buildRecentActivity({
        decisions: status?.recentDecisions ?? [],
        logs: status?.recentLogs ?? [],
        limit: 8,
      }),
    [status?.recentDecisions, status?.recentLogs],
  );

  const managedSet = useMemo(
    () => new Set(managedSymbols.map((s) => s.toUpperCase())),
    [managedSymbols],
  );

  const openPosition = useMemo(() => {
    const positions = t?.openPositions ?? [];
    const managed =
      positions.find((p) => managedSet.has(p.symbol.toUpperCase())) ??
      positions[0];
    if (!managed) return null;
    return {
      symbol: managed.symbol,
      qty: managed.qty,
      unrealizedPl: managed.unrealizedPl,
    };
  }, [t?.openPositions, managedSet]);

  const dailyTradesUsed = status?.dailyTradesUsed ?? 0;
  const maxDailyTrades =
    status?.maxDailyTrades ?? status?.runtimeSettings?.maxTradesPerDay ?? 0;

  const primary = useMemo(
    () =>
      resolvePrimaryStatus({
        blockerSummary,
        autoTradingOn: autoOn,
        executionOn,
        marketOpen: t?.marketOpen,
        hasOpenPosition: Boolean(openPosition),
        hasQualifiedBuy: hasBuy,
        dailyTradesUsed,
        maxDailyTrades,
        panicStop: Boolean(status?.panicStop ?? engine?.panicStopActive),
        killSwitch: Boolean(status?.killSwitch ?? engine?.killSwitchActive),
      }),
    [
      blockerSummary,
      autoOn,
      executionOn,
      t?.marketOpen,
      openPosition,
      hasBuy,
      dailyTradesUsed,
      maxDailyTrades,
      status?.panicStop,
      status?.killSwitch,
      engine?.panicStopActive,
      engine?.killSwitchActive,
    ],
  );

  const riskLimits = status?.runtimeSettings
    ? {
        maxRiskPerTradePct: status.runtimeSettings.maxRiskPerTradePct,
        maxTradesPerDay: status.runtimeSettings.maxTradesPerDay,
        maxOpenPositions: status.runtimeSettings.maxOpenPositions,
        maxDailyLossPct: status.runtimeSettings.maxDailyLossPct,
        maxPositionAllocationPct: status.runtimeSettings.maxPositionAllocationPct,
      }
    : null;

  const openPositions = t?.openPositions ?? [];
  const orphaned = t?.orphanedPositions ?? [];
  const dailyLimitReached =
    maxDailyTrades > 0 && dailyTradesUsed >= maxDailyTrades;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8 lg:gap-5">
      <PageHeader
        title="Auto Trading"
        description="Start, stop, or run the automated paper-trading system."
      />

      <AutoTradeControlsPanel
        engine={engine}
        busy={busy}
        feedback={feedback}
        marketOpen={t?.marketOpen}
        positions={openPositions}
        riskLimits={riskLimits}
        eligibleCount={t?.universe?.eligibleCount}
        reconciliationComplete={t?.reconciliationComplete}
        hasCriticalLifecycleWarning={needsIntervention}
        onAction={postAction}
        onOpenSettings={() => setSettingsOpen(true)}
        systemError={error}
        onRetry={() => void refresh()}
        brokerConnected={t?.alpacaConnected ?? null}
        dailyLimitReached={dailyLimitReached}
        compactStatus={
          <AutoTradeOverviewCard
            loading={!status}
            primary={primary}
            marketOpen={t?.marketOpen}
            autoTradingOn={autoOn}
            executionOn={executionOn}
            equity={t?.equity}
            dailyPnL={t?.dailyPnL}
            openPosition={openPosition}
            dailyTradesUsed={dailyTradesUsed}
            maxDailyTrades={maxDailyTrades}
            staleUpdate={staleUpdate}
          />
        }
        moreActions={
          <AutoTradeEmergencyControls
            engine={engine}
            busy={busy}
            marketOpen={t?.marketOpen}
            positions={openPositions}
            onAction={postAction}
          />
        }
      />

      <AdvancedAutoTradeDetails
        status={status}
        orders={orders}
        engineNotes={engine?.blockingReasons ?? []}
        legacySection={
          <ExternalPositionsWarning
            positions={openPositions}
            managedSymbols={managedSymbols}
            orphanedSymbols={orphaned.map((o) => o.symbol)}
          />
        }
      >
        <ExpandableSection
          title="Position Details"
          defaultOpen={false}
          expandLabel="View position details"
          collapseLabel="Hide position details"
          tip={
            <AutoTradeInfoTip text="Entry, exits, and protection for the current Version 1 managed trade." />
          }
          summary={
            openPosition
              ? `${openPosition.symbol} is open — details live on Positions; expand for managed-trade diagnostics.`
              : "No open managed position right now."
          }
        >
          <V1ManagedTradeCard onNeedsIntervention={setNeedsIntervention} />
        </ExpandableSection>

        <ExpandableSection
          title="Today's Activity"
          expandLabel="View activity"
          collapseLabel="Hide activity"
          tip={
            <AutoTradeInfoTip text="Daily goal progress and recent paper trading events." />
          }
          summary="Daily goal, wins and losses, and recent activity."
        >
          <div className="space-y-6">
            <V1DailyProgressPanel
              executionOff={!executionOn}
              autoOff={!autoOn}
            />
            <RecentAutoTradeActivity items={activity} loading={!status} />
          </div>
        </ExpandableSection>

        <ExpandableSection
          title="Risk Protection"
          expandLabel="View risk details"
          collapseLabel="Hide risk details"
          tip={
            <AutoTradeInfoTip text="Why trading may be blocked, plus the risk limits that protect the paper account." />
          }
          summary="Blockers, risk limits, and safety context."
        >
          <div className="space-y-6">
            <TradingBlockersPanel summary={blockerSummary} loading={!status} />
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-100">
                Risk limits
                <AutoTradeInfoTip text="These limits apply before any paper order can submit." />
              </h3>
              {riskLimits ? (
                <ul className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
                  <li>Risk per trade: {fmtPct(riskLimits.maxRiskPerTradePct)}</li>
                  <li>Max trades per day: {riskLimits.maxTradesPerDay}</li>
                  <li>Max open positions: {riskLimits.maxOpenPositions}</li>
                  <li>Daily loss limit: {fmtPct(riskLimits.maxDailyLossPct)}</li>
                  <li>
                    Max position size:{" "}
                    {fmtPct(riskLimits.maxPositionAllocationPct)}
                  </li>
                </ul>
              ) : (
                <p className="text-sm text-[var(--muted)]">Risk limits loading…</p>
              )}
            </div>
          </div>
        </ExpandableSection>

        <ExpandableSection
          title="How the strategy works"
          expandLabel="View strategy details"
          collapseLabel="Hide strategy details"
          tip={
            <AutoTradeInfoTip text="Plain-English strategy context, latest decision, and watchlist eligibility." />
          }
          summary="Strategy explanation, latest decision, and watchlist status."
        >
          <div className="space-y-6">
            <AutoTradeStatusHeader
              loading={!status}
              autoTradingOn={autoOn}
              executionOn={executionOn}
              marketOpen={t?.marketOpen}
              alpacaConnected={t?.alpacaConnected ?? false}
              dataFreshness={t?.universe?.dataFreshness}
              lastUpdatedAt={lastUpdatedAt}
              staleUpdate={staleUpdate}
            />
            <LatestStrategyDecisionCard onHasBuyChange={setHasBuy} />
            <V1UniversePanel universe={t?.universe ?? null} />
          </div>
        </ExpandableSection>
      </AdvancedAutoTradeDetails>

      <TradingSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initial={status?.runtimeSettings ?? null}
        onSaved={() => {
          void refresh();
        }}
      />
    </div>
  );
}
