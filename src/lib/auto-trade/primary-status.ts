/**
 * Presentation helper — picks one plain-English primary status for the Auto Trade overview.
 * Does not change backend safety rules.
 */

import type { OperatorBlockerSummary } from "@/lib/auto-trade/operator-blockers";

export type PrimaryStatusTone = "ok" | "warn" | "bad" | "neutral" | "info";

export type PrimaryStatus = {
  message: string;
  tone: PrimaryStatusTone;
  detail?: string | null;
};

export function resolvePrimaryStatus(input: {
  blockerSummary: OperatorBlockerSummary | null;
  autoTradingOn: boolean;
  executionOn: boolean;
  marketOpen: boolean | null | undefined;
  hasOpenPosition: boolean;
  hasQualifiedBuy: boolean | null;
  dailyTradesUsed: number;
  maxDailyTrades: number;
  panicStop: boolean;
  killSwitch: boolean;
}): PrimaryStatus {
  const {
    blockerSummary,
    autoTradingOn,
    executionOn,
    marketOpen,
    hasOpenPosition,
    hasQualifiedBuy,
    dailyTradesUsed,
    maxDailyTrades,
    panicStop,
    killSwitch,
  } = input;

  if (panicStop || killSwitch) {
    return {
      message: "Safety protection stopped trading",
      tone: "bad",
      detail: blockerSummary?.primary?.explanation ?? null,
    };
  }

  if (marketOpen === false) {
    return {
      message: "Market is closed",
      tone: "neutral",
      detail: "New paper entries wait until the regular US market session opens.",
    };
  }

  if (maxDailyTrades > 0 && dailyTradesUsed >= maxDailyTrades) {
    return {
      message: "Daily trade limit reached",
      tone: "warn",
      detail: "No more new entries today. Open positions can still be managed.",
    };
  }

  const primary = blockerSummary?.primary;
  if (
    primary?.id === "max_trades" ||
    primary?.id === "daily_cap" ||
    primary?.id === "daily_trade_limit" ||
    primary?.label.toLowerCase().includes("daily trade") ||
    primary?.label.toLowerCase().includes("maximum trades")
  ) {
    return {
      message: "Daily trade limit reached",
      tone: "warn",
      detail: primary.explanation,
    };
  }

  if (primary?.severity === "critical") {
    return {
      message: "Safety protection stopped trading",
      tone: "bad",
      detail: primary.explanation,
    };
  }

  if (
    blockerSummary?.tradingActive &&
    autoTradingOn &&
    executionOn &&
    !hasOpenPosition &&
    hasQualifiedBuy !== true
  ) {
    return {
      message: "Waiting for a valid setup",
      tone: "warn",
      detail: "Auto-trading is on and watching the watchlist for a qualified paper entry.",
    };
  }

  if (blockerSummary?.tradingActive && autoTradingOn && executionOn) {
    return {
      message: "Auto-trading is active",
      tone: "ok",
      detail: hasOpenPosition
        ? "A managed paper position is open."
        : "Ready to submit paper orders when a qualified setup appears.",
    };
  }

  if (primary) {
    const label = primary.label.replace(/\.$/, "");
    return {
      message: friendlyPrimaryLabel(label),
      tone: "warn",
      detail: primary.explanation,
    };
  }

  if (!autoTradingOn) {
    return {
      message: "Auto-trading is off",
      tone: "neutral",
      detail: "Turn Auto Trading on when you want the system to submit paper orders automatically.",
    };
  }

  return {
    message: "Waiting for a valid setup",
    tone: "warn",
    detail: null,
  };
}

function friendlyPrimaryLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("market") && lower.includes("closed")) return "Market is closed";
  if (lower.includes("emergency") || lower.includes("kill") || lower.includes("safety")) {
    return "Safety protection stopped trading";
  }
  if (lower.includes("daily") && lower.includes("limit")) return "Daily trade limit reached";
  if (lower.includes("waiting") || lower.includes("setup") || lower.includes("qualified")) {
    return "Waiting for a valid setup";
  }
  if (lower.includes("active") && lower.includes("ready")) return "Auto-trading is active";
  return label;
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function pnlToneClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "text-zinc-100";
  return n > 0 ? "text-emerald-300" : "text-red-300";
}
