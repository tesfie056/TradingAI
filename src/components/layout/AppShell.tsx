"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { MobileNavigationDrawer } from "@/components/layout/MobileNavigationDrawer";
import {
  UiChromeProvider,
  useUiChrome,
} from "@/components/layout/UiChromeContext";
import {
  MonitorStreamProvider,
  useMonitorStream,
} from "@/components/layout/MonitorStreamContext";
import { AiAssistantPopup } from "@/components/AiAssistantPopup";
import { ToastProvider } from "@/components/ui/Toast";
import { StockWorkspaceProvider } from "@/components/stock/StockWorkspaceContext";
import { GlobalStatusHeader } from "@/components/status/GlobalStatusHeader";
import { SystemStatusPanel } from "@/components/status/SystemStatusPanel";
import { fetchJson } from "@/lib/client/fetch-json";
import { aiStatusDisplayLabel } from "@/lib/client/block-reasons";
import { buildSystemStatusItems } from "@/lib/client/status-state-mapper";
import { lastEvaluatedSymbolFromLogs } from "@/lib/client/runtime-status-mapper";
import type {
  AiHealthPayload,
  NewsPayload,
  SafetyPayload,
} from "@/lib/dashboard-types";
import type { MarketClockStatus } from "@/lib/alpaca/types";

type ShellStatus = {
  orderExecutionEnabled: boolean;
  autoTradingEnabled: boolean;
  marketOpen: boolean | null;
  aiProvider: string;
  newsProvider: string;
  safetyOk: boolean;
  safetyLabel: string;
  brokerConnected: boolean | null;
  engineState: string | null;
  runtimeDisabled: boolean | null;
  checkedAt: string | null;
};

const FALLBACK: ShellStatus = {
  orderExecutionEnabled: false,
  autoTradingEnabled: false,
  marketOpen: null,
  aiProvider: "AI fallback: heuristic",
  newsProvider: "—",
  safetyOk: false,
  safetyLabel: "checking",
  brokerConnected: null,
  engineState: null,
  runtimeDisabled: null,
  checkedAt: null,
};

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { viewMode, toggleViewMode, openAi, aiIndicator, aiOpen } =
    useUiChrome();
  const monitor = useMonitorStream();
  const [status, setStatus] = useState<ShellStatus>(FALLBACK);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [liveMsg, setLiveMsg] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const prevCriticalRef = useRef<string>("");

  const loadStatus = useCallback(async () => {
    try {
      const [safety, clock, news, ai, trades, autoTrade] = await Promise.all([
        fetchJson<SafetyPayload>("/api/safety").catch(() => null),
        fetchJson<{ clock: MarketClockStatus }>("/api/market/clock").catch(
          () => null,
        ),
        fetchJson<NewsPayload>("/api/news").catch(() => null),
        fetchJson<AiHealthPayload>("/api/ai/health").catch(() => null),
        fetchJson<{ orderExecutionEnabled?: boolean }>("/api/trades").catch(
          () => null,
        ),
        fetchJson<{
          effectivelyEnabled?: boolean;
          envEnabled?: boolean;
          runtimeDisabled?: boolean;
          engine?: {
            autoTradingEnabled?: boolean;
            executionEnabled?: boolean;
            engineState?: string;
          };
          trader?: { alpacaConnected?: boolean };
        }>("/api/auto-trade").catch(() => null),
      ]);
      setStatus({
        orderExecutionEnabled:
          trades?.orderExecutionEnabled ??
          autoTrade?.engine?.executionEnabled ??
          ai?.orderExecutionEnabled ??
          false,
        autoTradingEnabled:
          autoTrade?.engine?.autoTradingEnabled ??
          autoTrade?.effectivelyEnabled ??
          autoTrade?.envEnabled ??
          false,
        marketOpen: clock?.clock?.isOpen ?? null,
        aiProvider: aiStatusDisplayLabel(
          ai?.statusLabel ?? news?.aiStatus?.activeProvider ?? "heuristic",
        ),
        newsProvider: news?.provider ?? "mock",
        safetyOk: safety?.ok ?? false,
        safetyLabel: safety?.ok
          ? (safety.tradingEndpoint?.replace("https://", "") ?? "paper-api")
          : (safety?.error?.slice(0, 40) ?? "fail"),
        brokerConnected: autoTrade?.trader?.alpacaConnected ?? null,
        engineState: autoTrade?.engine?.engineState ?? null,
        runtimeDisabled: autoTrade?.runtimeDisabled ?? null,
        checkedAt: new Date().toISOString(),
      });
    } catch {
      setStatus((s) => ({ ...s, safetyOk: false, safetyLabel: "error" }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadStatus();
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, refreshNonce, loadStatus]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const shellMarketOpen = monitor.marketOpen ?? status.marketOpen;

  const statusProps = useMemo(
    () => ({
      paperOnly: true as const,
      orderExecutionEnabled: status.orderExecutionEnabled,
      autoTradingEnabled: status.autoTradingEnabled,
      marketOpen: shellMarketOpen,
      aiProvider: status.aiProvider,
      newsProvider: viewMode === "advanced" ? status.newsProvider : undefined,
      safetyOk: status.safetyOk,
      safetyLabel: status.safetyLabel,
      agentConnected: monitor.connected,
      agentHeartbeatAt: monitor.heartbeatAt,
      agentRunning: monitor.workerRunning,
      agentScanning: monitor.scanning,
      brokerConnected: status.brokerConnected,
      monitorLastError: monitor.status?.lastError ?? null,
      monitorLastScanAt: monitor.status?.lastScanAt ?? null,
      monitorNextScanAt: monitor.status?.nextScanAt ?? null,
      monitorStocksScanned: monitor.status?.stocksScanned ?? null,
      monitorOllamaAvailable: monitor.status?.ollamaAvailable ?? null,
      engineState: status.engineState,
      runtimeDisabled: status.runtimeDisabled,
      lastEvaluatedSymbol: lastEvaluatedSymbolFromLogs(
        monitor.status?.recentLogs,
      ),
      checkedAt: status.checkedAt,
    }),
    [
      status,
      shellMarketOpen,
      viewMode,
      monitor.connected,
      monitor.heartbeatAt,
      monitor.workerRunning,
      monitor.scanning,
      monitor.status?.lastError,
      monitor.status?.lastScanAt,
      monitor.status?.nextScanAt,
      monitor.status?.stocksScanned,
      monitor.status?.ollamaAvailable,
      monitor.status?.recentLogs,
    ],
  );

  const items = useMemo(
    () => buildSystemStatusItems(statusProps),
    [statusProps],
  );

  useEffect(() => {
    const criticalKey = items
      .filter((i) => i.critical)
      .map((i) => `${i.key}:${i.state}`)
      .join("|");
    if (criticalKey && criticalKey !== prevCriticalRef.current) {
      const first = items.find((i) => i.critical);
      if (first) {
        setLiveMsg(`${first.name} ${first.state}. ${first.detail}`);
        window.setTimeout(() => setLiveMsg(null), 4000);
      }
    }
    prevCriticalRef.current = criticalKey;
  }, [items]);

  const openPanel = useCallback((trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  return (
    <div className="flex min-h-dvh flex-1 bg-[var(--background)]">
      <DesktopSidebar
        status={statusProps}
        onAskAi={() => openAi()}
        aiThinking={!aiOpen && aiIndicator.thinking}
        aiResultsReady={!aiOpen ? aiIndicator.resultsReady : 0}
        onToggleViewMode={toggleViewMode}
        viewMode={viewMode}
        onOpenSystemStatus={() => openPanel(null)}
      />

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <MobileTopBar onOpenMenu={() => setMobileNavOpen(true)} />
        <GlobalStatusHeader
          items={items}
          open={panelOpen}
          onOpen={openPanel}
        />
        {liveMsg ? (
          <p className="sr-only" aria-live="assertive" role="status">
            {liveMsg}
          </p>
        ) : null}
        <main className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </main>
      </div>

      <MobileNavigationDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        status={statusProps}
        onAskAi={() => openAi()}
        aiThinking={!aiOpen && aiIndicator.thinking}
        aiResultsReady={!aiOpen ? aiIndicator.resultsReady : 0}
        onOpenSystemStatus={() => {
          setMobileNavOpen(false);
          openPanel(null);
        }}
      />

      <SystemStatusPanel
        open={panelOpen}
        items={items}
        onClose={closePanel}
        onRefresh={() => setRefreshNonce((n) => n + 1)}
        returnFocusRef={triggerRef}
      />
      <AiAssistantPopup />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <UiChromeProvider>
      <MonitorStreamProvider>
        <ToastProvider>
          <StockWorkspaceProvider>
            <AppShellInner>{children}</AppShellInner>
          </StockWorkspaceProvider>
        </ToastProvider>
      </MonitorStreamProvider>
    </UiChromeProvider>
  );
}
