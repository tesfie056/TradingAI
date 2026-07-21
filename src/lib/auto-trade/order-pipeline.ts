/**
 * Plain-English Auto Trading order pipeline for UI.
 * Derives stages from existing monitor + auto-trade decisions — no second order path.
 */

import type { AutoTradeDecision, AutoTradeSkipCode } from "@/lib/auto-trade/types";
import { formatSkipReason } from "@/lib/auto-trade/display";
import type { MonitorOpportunity } from "@/lib/monitor/types";

export type OrderPipelineStage =
  | "scanning"
  | "setup_found"
  | "checking_eligibility"
  | "waiting_for_market"
  | "paused"
  | "execution_off"
  | "auto_off"
  | "preparing_order"
  | "submitting"
  | "accepted"
  | "filled"
  | "protection_active"
  | "rejected"
  | "expired"
  | "idle";

export type OrderPipelineView = {
  stage: OrderPipelineStage;
  stageLabel: string;
  symbol: string | null;
  headline: string;
  detail: string;
  stopReason: string | null;
  stages: Array<{ id: OrderPipelineStage; label: string; done: boolean; current: boolean }>;
};

const FLOW: Array<{ id: OrderPipelineStage; label: string }> = [
  { id: "scanning", label: "Scanning" },
  { id: "setup_found", label: "Setup found" },
  { id: "checking_eligibility", label: "Checking eligibility" },
  { id: "waiting_for_market", label: "Waiting for market" },
  { id: "preparing_order", label: "Preparing paper order" },
  { id: "submitting", label: "Submitting" },
  { id: "accepted", label: "Accepted" },
  { id: "filled", label: "Filled" },
  { id: "protection_active", label: "Protection active" },
];

function stageLabel(stage: OrderPipelineStage): string {
  return FLOW.find((s) => s.id === stage)?.label ?? stage.replace(/_/g, " ");
}

function isExpired(opp: MonitorOpportunity | null | undefined, nowMs: number): boolean {
  if (!opp?.expiresAt) return false;
  const t = Date.parse(opp.expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

function marketClosedHint(
  opp: MonitorOpportunity | null | undefined,
  marketOpen: boolean | null | undefined,
): boolean {
  // Never treat open broker session as closed from free text.
  if (marketOpen === true || opp?.marketStatus === "open") return false;
  if (marketOpen === false || opp?.marketStatus === "closed") return true;
  return false;
}

function marketUnavailableHint(
  opp: MonitorOpportunity | null | undefined,
  marketOpen: boolean | null | undefined,
): boolean {
  if (marketOpen === true || opp?.marketStatus === "open") return false;
  if (opp?.marketStatus === "unavailable") return true;
  if (marketOpen === null && opp?.marketStatus !== "closed") return true;
  return false;
}

export function buildOrderPipelineView(input: {
  scanning?: boolean;
  marketOpen?: boolean | null;
  autoTradingEnabled?: boolean;
  executionEnabled?: boolean;
  enginePaused?: boolean;
  pauseReason?: string | null;
  topOpportunity?: MonitorOpportunity | null;
  recentDecision?: AutoTradeDecision | null;
  protectionActive?: boolean;
  nowMs?: number;
}): OrderPipelineView {
  const now = input.nowMs ?? Date.now();
  const opp = input.topOpportunity ?? null;
  const decision = input.recentDecision ?? null;
  const symbol = decision?.symbol ?? opp?.symbol ?? null;

  let stage: OrderPipelineStage = "idle";
  let headline = "No active auto-trading setup";
  let detail =
    "When Auto Trading and Paper Execution are enabled, eligible setups from the monitor are submitted as Alpaca paper orders automatically.";
  let stopReason: string | null = null;

  if (input.scanning) {
    stage = "scanning";
    headline = "Scanning watchlist";
    detail = "Looking for setups to hand off to Auto Trading.";
  } else if (input.enginePaused) {
    stage = "paused";
    headline = symbol ? `${symbol} setup found` : "Auto Trading is paused";
    detail =
      input.pauseReason ??
      "New entries are paused. Resume Engine from Auto Trading to allow paper-order submission.";
    stopReason = detail;
  } else if (input.autoTradingEnabled === false) {
    stage = "auto_off";
    headline = symbol ? `${symbol} setup found` : "Auto Trading is off";
    detail = "Setups may be detected, but Auto Trading will not submit paper orders.";
    stopReason = "Order not submitted: Auto Trading is off.";
  } else if (input.executionEnabled === false) {
    stage = "execution_off";
    headline = symbol ? `${symbol} setup found` : "Paper execution is off";
    detail =
      "Setups may be detected, but paper order submission stays locked until execution is enabled.";
    stopReason = "Order not submitted: paper execution is off.";
  } else if (decision?.status === "filled" || input.protectionActive) {
    stage = input.protectionActive || decision?.status === "filled"
      ? "protection_active"
      : "filled";
    if (decision?.status === "filled" && !input.protectionActive) stage = "filled";
    if (input.protectionActive) stage = "protection_active";
    headline = symbol
      ? `${symbol} paper order ${stage === "protection_active" ? "protected" : "filled"}`
      : "Paper order filled";
    detail =
      stage === "protection_active"
        ? "Stop-loss and take-profit protection are active."
        : "Alpaca confirmed a fill. Protection sync runs on the next monitor cycle.";
  } else if (decision?.status === "submitted") {
    const os = (decision.orderStatus ?? "").toLowerCase();
    if (os.includes("fill")) {
      stage = "filled";
      headline = `${symbol} paper order filled`;
      detail = "Alpaca confirmed a fill.";
    } else {
      stage = "accepted";
      headline = `${symbol} paper order accepted`;
      detail =
        "Alpaca accepted the order request. Accepted is not the same as filled.";
    }
  } else if (decision?.status === "pending") {
    stage = "submitting";
    headline = `${symbol} preparing paper order`;
    detail = "Eligibility passed. Submitting the paper order to Alpaca.";
  } else if (decision?.status === "rejected") {
    stage = "rejected";
    headline = `${symbol} order rejected`;
    const code = decision.blockers[0]?.code as AutoTradeSkipCode | undefined;
    stopReason =
      decision.blockers[0]?.message ??
      formatSkipReason(code, "Alpaca or risk rejected the paper order.");
    detail = stopReason;
  } else if (decision?.status === "skipped") {
    const code = decision.blockers[0]?.code as AutoTradeSkipCode | undefined;
    const msg =
      decision.blockers[0]?.message ?? formatSkipReason(code, decision.reason);
    if (
      code === "market_status_unavailable" ||
      marketUnavailableHint(opp, input.marketOpen)
    ) {
      stage = "waiting_for_market";
      headline = `${symbol ?? "Setup"} found`;
      stopReason = "Order not submitted: market status unavailable.";
      detail =
        "Broker clock could not be confirmed. New orders stay blocked until market status is available.";
    } else if (code === "market_closed" || marketClosedHint(opp, input.marketOpen)) {
      stage = "waiting_for_market";
      headline = `${symbol ?? "Setup"} found`;
      stopReason = `Order not submitted: regular market is closed.`;
      detail =
        "A fresh eligibility check will run after market open. Stale prices are not used for submission.";
    } else {
      stage = "checking_eligibility";
      headline = `${symbol ?? "Setup"} found`;
      stopReason = `Order not submitted: ${msg}`;
      detail = stopReason;
    }
  } else if (opp && isExpired(opp, now)) {
    stage = "expired";
    headline = `${opp.symbol} setup expired`;
    stopReason =
      "Proposal expired before it could be submitted. A fresh scan is required.";
    detail = stopReason;
  } else if (opp && (opp.action === "BUY" || opp.action === "SELL")) {
    if (marketUnavailableHint(opp, input.marketOpen)) {
      stage = "waiting_for_market";
      headline = `${opp.symbol} ${opp.action} setup found`;
      stopReason = "Order not submitted: market status unavailable.";
      detail =
        "Broker clock could not be confirmed. New orders stay blocked until market status is available.";
    } else if (marketClosedHint(opp, input.marketOpen)) {
      stage = "waiting_for_market";
      headline = `${opp.symbol} ${opp.action} setup found`;
      stopReason = "Order not submitted: regular market is closed.";
      detail =
        "Waiting for market open before paper-order submission. A fresh eligibility check runs after the open.";
    } else if (!opp.readyForPaperPreview) {
      stage = "setup_found";
      headline = `${opp.symbol} ${opp.action} setup found`;
      stopReason =
        opp.blockedReasons[0] ??
        "Order not submitted: setup is not fully eligible yet.";
      detail = stopReason;
    } else {
      stage = "checking_eligibility";
      headline = `${opp.symbol} ${opp.action} setup found`;
      detail =
        "Signal is visible. Auto Trading will evaluate risk, duplicates, and account limits on the next scan cycle.";
    }
  }

  const flowIds = FLOW.map((f) => f.id);
  const currentIdx = flowIds.indexOf(stage);
  const stages = FLOW.map((f, i) => ({
    id: f.id,
    label: f.label,
    done: currentIdx >= 0 && i < currentIdx,
    current: f.id === stage || (currentIdx < 0 && false),
  }));

  // Mark terminal off-flow stages on the closest flow step
  if (stage === "paused" || stage === "auto_off" || stage === "execution_off") {
    const idx = flowIds.indexOf("checking_eligibility");
    for (let i = 0; i < stages.length; i++) {
      stages[i]!.done = i < idx;
      stages[i]!.current = i === idx;
    }
  } else if (stage === "rejected" || stage === "expired") {
    const idx = flowIds.indexOf("submitting");
    for (let i = 0; i < stages.length; i++) {
      stages[i]!.done = i < idx;
      stages[i]!.current = i === idx;
    }
  }

  return {
    stage,
    stageLabel: stageLabel(stage),
    symbol,
    headline,
    detail,
    stopReason,
    stages,
  };
}
