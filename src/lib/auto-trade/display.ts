import type { AutoTradeDecision, AutoTradeSkipCode } from "@/lib/auto-trade/types";
import type { MonitorStatus } from "@/lib/monitor/types";

export type AutoTradeUiStatus = "waiting" | "skipped" | "placed" | "rejected" | "off";

const SKIP_LABELS: Partial<Record<AutoTradeSkipCode, string>> = {
  low_confidence: "Confidence too low",
  duplicate_symbol: "Cooldown — duplicate symbol",
  symbol_cooldown: "Cooldown active",
  high_risk: "Risk high",
  kill_switch_active: "Kill switch active",
  panic_stop_active: "Panic stop active",
  auto_trading_disabled: "Auto trading disabled",
  execution_disabled: "Paper execution disabled",
  market_closed: "Market closed",
  stale_quote: "Stale quote",
  wide_spread: "Spread too wide",
  max_daily_trades: "Daily trade limit",
  max_daily_loss: "Daily loss limit",
  sell_auto_disabled: "SELL auto disabled",
  hold_action: "HOLD signal",
  watch_action: "WATCH signal",
  not_ready: "Not ready for trade",
  insufficient_buying_power: "Insufficient buying power",
  duplicate_opportunity: "Already processed",
  average_down_blocked: "No averaging down",
  revenge_trade_blocked: "No revenge trade",
  order_rejected: "Order rejected",
};

export function formatSkipReason(
  code: AutoTradeSkipCode | undefined,
  fallback?: string,
): string {
  if (code && SKIP_LABELS[code]) return SKIP_LABELS[code]!;
  if (fallback) return fallback;
  return "—";
}

export function mapDecisionToUiStatus(
  decision: AutoTradeDecision | null | undefined,
  autoEnabled: boolean,
): AutoTradeUiStatus {
  if (!autoEnabled) return "off";
  if (!decision) return "waiting";
  if (decision.status === "skipped") return "skipped";
  if (decision.status === "submitted" || decision.status === "filled") {
    return "placed";
  }
  if (decision.status === "rejected") return "rejected";
  if (decision.status === "pending") return "waiting";
  return "waiting";
}

export function autoTradeUiLabel(status: AutoTradeUiStatus): string {
  switch (status) {
    case "placed":
      return "placed";
    case "skipped":
      return "skipped";
    case "rejected":
      return "rejected";
    case "off":
      return "off";
    default:
      return "waiting";
  }
}

export function findDecisionForSymbol(
  decisions: AutoTradeDecision[],
  symbol: string | null | undefined,
): AutoTradeDecision | null {
  if (!symbol) return decisions[0] ?? null;
  const sym = symbol.toUpperCase();
  return (
    decisions.find((d) => d.symbol.toUpperCase() === sym) ?? decisions[0] ?? null
  );
}

export function buildAgentLiveSnapshot(input: {
  monitor: MonitorStatus | null;
  scanning: boolean;
  autoEnabled: boolean;
  recentDecisions: AutoTradeDecision[];
  scannedCount?: number;
  topSignalLabel?: string | null;
}): {
  scanningLabel: string;
  lastScan: string;
  nextScan: string;
  topSymbol: string;
  topAction: string;
  topSignalLabel: string;
  scannedCount: number;
  autoStatus: AutoTradeUiStatus;
  autoStatusLabel: string;
  reason: string;
} {
  const top = input.monitor?.topOpportunity ?? null;
  const scannedCount =
    input.scannedCount ??
    input.monitor?.stocksScanned ??
    input.monitor?.scannedSymbols?.length ??
    0;
  const decision = findDecisionForSymbol(input.recentDecisions, top?.symbol);
  const autoStatus = mapDecisionToUiStatus(decision, input.autoEnabled);
  const primaryBlocker = decision?.blockers[0];

  let reason = "—";
  if (autoStatus === "skipped" && primaryBlocker) {
    reason = formatSkipReason(primaryBlocker.code, primaryBlocker.message);
  } else if (autoStatus === "placed") {
    reason = decision?.orderStatus
      ? `Order ${decision.orderStatus}`
      : "Paper order submitted";
  } else if (autoStatus === "waiting" && top && !top.readyForPaperPreview) {
    reason = top.blockedReasons[0] ?? "Awaiting eligible signal";
  } else if (autoStatus === "waiting" && !top) {
    reason = "No active signal";
  } else if (autoStatus === "off") {
    reason = "Auto trading is paused";
  } else if (autoStatus === "rejected") {
    reason = primaryBlocker?.message ?? "Order rejected";
  }

  const topSignalLabel =
    input.topSignalLabel ??
    input.monitor?.topSignalLabel ??
    (top && scannedCount > 0
      ? `Top signal from ${scannedCount} scanned symbols: ${top.symbol} · ${top.action}`
      : top
        ? `Top signal: ${top.symbol} · ${top.action}`
        : "No scan yet");

  return {
    scanningLabel: input.scanning ? "Scanning now…" : "Idle",
    lastScan: input.monitor?.lastScanAt ?? "",
    nextScan: input.monitor?.nextScanAt ?? "",
    topSymbol: top?.symbol ?? "—",
    topAction: top?.action ?? "—",
    topSignalLabel,
    scannedCount,
    autoStatus,
    autoStatusLabel: autoTradeUiLabel(autoStatus),
    reason,
  };
}
