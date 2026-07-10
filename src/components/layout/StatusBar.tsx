"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/badges";
import { formatTime } from "@/lib/format";

export type StatusBarProps = {
  paperOnly?: boolean;
  orderExecutionEnabled: boolean;
  marketOpen: boolean | null;
  aiProvider: string;
  newsProvider: string;
  safetyOk: boolean;
  safetyLabel?: string;
  viewMode?: "simple" | "advanced";
  onToggleViewMode?: () => void;
  onAskAi?: () => void;
  /** Active AI task while popup is closed/minimized */
  aiThinking?: boolean;
  /** Completed answers waiting while popup was closed */
  aiResultsReady?: number;
  /** Live monitor worker heartbeat (SSE) */
  agentConnected?: boolean;
  agentHeartbeatAt?: string | null;
  agentRunning?: boolean;
  agentScanning?: boolean;
};

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/monitor", label: "Monitor" },
  { href: "/auto-trade", label: "Auto Trade" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/trade", label: "Trade" },
  { href: "/assistant", label: "Assistant" },
  { href: "/performance", label: "Performance" },
  { href: "/backtest", label: "Backtest" },
  { href: "/settings", label: "Settings" },
  { href: "/logs", label: "Logs" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/" || pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StatusBar({
  paperOnly = true,
  orderExecutionEnabled,
  marketOpen,
  aiProvider,
  newsProvider,
  safetyOk,
  safetyLabel,
  viewMode = "simple",
  onToggleViewMode,
  onAskAi,
  aiThinking = false,
  aiResultsReady = 0,
  agentConnected = false,
  agentHeartbeatAt = null,
  agentRunning = false,
  agentScanning = false,
}: StatusBarProps) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/dashboard"
              className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--foreground)] sm:text-[1.7rem]"
            >
              TradingAI
            </Link>
            <p className="mt-0.5 text-sm text-amber-300/90">
              U.S. stocks · paper trading desk
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => (onAskAi ? onAskAi() : router.push("/assistant"))}
              className="ui-btn relative border border-amber-500/45 bg-amber-500/15 text-amber-50 hover:bg-amber-500/25"
              aria-label={
                aiThinking
                  ? "AI Assistant — thinking"
                  : aiResultsReady > 0
                    ? "AI Assistant — result ready"
                    : "AI Assistant"
              }
            >
              <span className="inline-flex items-center gap-2">
                AI Assistant
                {aiThinking ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-100/90">
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300"
                      aria-hidden
                    />
                    Thinking
                  </span>
                ) : null}
                {!aiThinking && aiResultsReady > 0 ? (
                  <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-[11px] font-medium text-emerald-100 ring-1 ring-emerald-400/35">
                    {aiResultsReady === 1
                      ? "1 result ready"
                      : `${aiResultsReady} results ready`}
                  </span>
                ) : null}
              </span>
            </button>
            {onToggleViewMode ? (
              <button
                type="button"
                onClick={onToggleViewMode}
                className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--foreground)] hover:border-amber-500/35"
              >
                {viewMode === "simple" ? "Simple View" : "Advanced View"}
              </button>
            ) : null}
          </div>
        </div>

        <nav
          aria-label="Primary"
          className="flex w-full gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-amber-500/18 text-amber-50 ring-1 ring-amber-500/40"
                    : "text-[var(--muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--foreground)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          <StatusPill
            label={
              agentScanning
                ? "Agent scanning"
                : agentRunning
                  ? "Agent live"
                  : agentConnected
                    ? "Agent idle"
                    : "Agent offline"
            }
            tone={
              agentScanning
                ? "warn"
                : agentRunning
                  ? "ok"
                  : agentConnected
                    ? "neutral"
                    : "bad"
            }
          />
          {agentHeartbeatAt ? (
            <StatusPill
              label={`Heartbeat ${formatTime(agentHeartbeatAt)}`}
              tone={agentConnected ? "ok" : "neutral"}
            />
          ) : null}
          <StatusPill
            label={paperOnly ? "Paper only" : "PAPER ONLY"}
            tone="accent"
          />
          <StatusPill
            label={`Execution ${orderExecutionEnabled ? "ON" : "OFF"}`}
            tone={orderExecutionEnabled ? "warn" : "neutral"}
          />
          <StatusPill
            label={
              marketOpen == null
                ? "Market —"
                : marketOpen
                  ? "Market open"
                  : "Market closed"
            }
            tone={
              marketOpen == null ? "neutral" : marketOpen ? "ok" : "warn"
            }
          />
          <StatusPill
            label={
              aiProvider.startsWith("AI") ? aiProvider : `AI ${aiProvider}`
            }
            tone={
              aiProvider.includes("Ollama") && !aiProvider.includes("fallback")
                ? "ok"
                : "warn"
            }
          />
          {viewMode === "advanced" ? (
            <StatusPill label={`News ${newsProvider}`} tone="neutral" />
          ) : null}
          <StatusPill
            label={
              safetyOk
                ? "Platform Safe: Paper Only"
                : `Platform issue${safetyLabel ? `: ${safetyLabel}` : ""}`
            }
            tone={safetyOk ? "ok" : "bad"}
          />
        </div>
      </div>
    </header>
  );
}
