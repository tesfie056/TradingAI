"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMonitorStream } from "@/components/layout/MonitorStreamContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { UnprotectedPositionsBanner } from "@/components/ui/UnprotectedPositionsBanner";
import { fetchJson } from "@/lib/client/fetch-json";
import type { TradeRow } from "@/lib/dashboard-types";
import type { AutoTradeStatus } from "@/lib/auto-trade/types";
import { buildOperatorBlockers } from "@/lib/auto-trade/operator-blockers";
import { TradingSettingsDrawer } from "@/components/auto-trade/TradingSettingsDrawer";
import { AutoTradeControlsPanel } from "@/components/auto-trade/AutoTradeControlsPanel";
import { AutoTradeStatusHeader } from "@/components/auto-trade/AutoTradeStatusHeader";
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 pb-10 sm:px-4 lg:gap-5">
      <PageHeader
        title="Auto Trade"
        description="Version 1 paper operator desk — long-only, paper only, live trading blocked."
      />
      <SafetyBanner
        orderExecutionEnabled={executionOn}
        autoTradingEnabled={autoOn}
        engineState={engine?.engineState}
      />
      <UnprotectedPositionsBanner
        positions={(t?.orphanedPositions ?? []).map((o) => ({
          symbol: o.symbol,
          reason: o.reason,
        }))}
      />

      {error ? (
        <div
          className="rounded-[var(--radius)] border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-100"
          role="alert"
        >
          <p className="font-medium">Unable to refresh Auto Trade status</p>
          <p className="mt-1 text-red-100/80">{error}</p>
          <button
            type="button"
            className="ui-btn mt-2 border border-red-400/40 text-sm"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      ) : null}

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

      <div className="grid gap-4 lg:grid-cols-2">
        <V1DailyProgressPanel
          executionOff={!executionOn}
          autoOff={!autoOn}
        />
        <TradingBlockersPanel summary={blockerSummary} loading={!status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <V1ManagedTradeCard onNeedsIntervention={setNeedsIntervention} />
        <LatestStrategyDecisionCard onHasBuyChange={setHasBuy} />
      </div>

      <ExternalPositionsWarning
        positions={t?.openPositions ?? []}
        managedSymbols={managedSymbols}
        orphanedSymbols={(t?.orphanedPositions ?? []).map((o) => o.symbol)}
      />

      <AutoTradeControlsPanel
        engine={engine}
        busy={busy}
        feedback={feedback}
        marketOpen={t?.marketOpen}
        positions={t?.openPositions ?? []}
        riskLimits={
          status?.runtimeSettings
            ? {
                maxRiskPerTradePct: status.runtimeSettings.maxRiskPerTradePct,
                maxTradesPerDay: status.runtimeSettings.maxTradesPerDay,
                maxOpenPositions: status.runtimeSettings.maxOpenPositions,
                maxDailyLossPct: status.runtimeSettings.maxDailyLossPct,
                maxPositionAllocationPct:
                  status.runtimeSettings.maxPositionAllocationPct,
              }
            : null
        }
        eligibleCount={t?.universe?.eligibleCount}
        reconciliationComplete={t?.reconciliationComplete}
        hasCriticalLifecycleWarning={needsIntervention}
        onAction={postAction}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <V1UniversePanel universe={t?.universe ?? null} />
        <RecentAutoTradeActivity items={activity} loading={!status} />
      </div>

      <AdvancedAutoTradeDetails status={status} orders={orders} />

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
