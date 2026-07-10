"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { StatusBar } from "@/components/layout/StatusBar";
import {
  UiChromeProvider,
  useUiChrome,
} from "@/components/layout/UiChromeContext";
import { fetchJson } from "@/lib/client/fetch-json";
import { aiStatusDisplayLabel } from "@/lib/client/block-reasons";
import type {
  AiHealthPayload,
  NewsPayload,
  SafetyPayload,
} from "@/lib/dashboard-types";
import type { MarketClockStatus } from "@/lib/alpaca/types";

type ShellStatus = {
  orderExecutionEnabled: boolean;
  marketOpen: boolean | null;
  aiProvider: string;
  newsProvider: string;
  safetyOk: boolean;
  safetyLabel: string;
};

const FALLBACK: ShellStatus = {
  orderExecutionEnabled: false,
  marketOpen: null,
  aiProvider: "AI fallback: heuristic",
  newsProvider: "—",
  safetyOk: false,
  safetyLabel: "checking",
};

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { viewMode, toggleViewMode } = useUiChrome();
  const [status, setStatus] = useState<ShellStatus>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [safety, clock, news, ai, trades] = await Promise.all([
          fetchJson<SafetyPayload>("/api/safety").catch(() => null),
          fetchJson<{ clock: MarketClockStatus }>("/api/market/clock").catch(
            () => null,
          ),
          fetchJson<NewsPayload>("/api/news").catch(() => null),
          fetchJson<AiHealthPayload>("/api/ai/health").catch(() => null),
          fetchJson<{ orderExecutionEnabled?: boolean }>("/api/trades").catch(
            () => null,
          ),
        ]);
        if (cancelled) return;
        setStatus({
          orderExecutionEnabled:
            trades?.orderExecutionEnabled ??
            ai?.orderExecutionEnabled ??
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
        });
      } catch {
        if (!cancelled) {
          setStatus((s) => ({ ...s, safetyOk: false, safetyLabel: "error" }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <StatusBar
        paperOnly
        orderExecutionEnabled={status.orderExecutionEnabled}
        marketOpen={status.marketOpen}
        aiProvider={status.aiProvider}
        newsProvider={status.newsProvider}
        safetyOk={status.safetyOk}
        safetyLabel={status.safetyLabel}
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
      />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        {children}
      </main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <UiChromeProvider>
      <AppShellInner>{children}</AppShellInner>
    </UiChromeProvider>
  );
}
