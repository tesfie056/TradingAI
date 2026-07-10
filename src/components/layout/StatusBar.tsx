"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusPill } from "@/components/ui/badges";

export type StatusBarProps = {
  paperOnly?: boolean;
  orderExecutionEnabled: boolean;
  marketOpen: boolean | null;
  aiProvider: string;
  newsProvider: string;
  safetyOk: boolean;
  safetyLabel?: string;
};

const NAV = [
  { href: "/", label: "Control Room" },
  { href: "/performance", label: "Performance" },
  { href: "/backtest", label: "Backtest" },
  { href: "/settings", label: "Settings" },
  { href: "/logs", label: "Logs" },
] as const;

export function StatusBar({
  paperOnly = true,
  orderExecutionEnabled,
  marketOpen,
  aiProvider,
  newsProvider,
  safetyOk,
  safetyLabel,
}: StatusBarProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--foreground)] sm:text-xl">
              TradingAI
            </p>
            <p className="text-[10px] tracking-[0.16em] text-amber-400/90 uppercase sm:text-[11px]">
              U.S. stocks · paper control room
            </p>
          </div>
          <nav
            aria-label="Primary"
            className="flex w-full gap-1 overflow-x-auto pb-0.5 sm:w-auto sm:flex-wrap sm:overflow-visible"
          >
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 border px-2.5 py-1.5 text-xs font-medium transition ${
                    active
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-50"
                      : "border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible">
          <StatusPill
            label={paperOnly ? "Paper Trading Only" : "PAPER ONLY"}
            tone="accent"
          />
          <StatusPill
            label={`Order Execution ${orderExecutionEnabled ? "ON" : "OFF"}`}
            tone={orderExecutionEnabled ? "warn" : "neutral"}
          />
          <StatusPill
            label={
              marketOpen == null
                ? "Market —"
                : marketOpen
                  ? "Market Open"
                  : "Market Closed"
            }
            tone={
              marketOpen == null ? "neutral" : marketOpen ? "ok" : "warn"
            }
          />
          <StatusPill label={`AI ${aiProvider}`} tone="neutral" />
          <StatusPill label={`News ${newsProvider}`} tone="neutral" />
          <StatusPill
            label={
              safetyOk
                ? `Safety OK${safetyLabel ? ` · ${safetyLabel}` : ""}`
                : `Safety Fail${safetyLabel ? ` · ${safetyLabel}` : ""}`
            }
            tone={safetyOk ? "ok" : "bad"}
          />
        </div>

        <div className="border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
          <span className="font-semibold tracking-wide uppercase">
            Paper trade only
          </span>
          {" · "}
          no live trading · no automatic trading · U.S. stocks only · manual
          approval required for every order
        </div>
      </div>
    </header>
  );
}
