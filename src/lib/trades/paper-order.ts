import {
  getLatestBars,
  getLatestQuotes,
  getMarketClock,
  placePaperOrder,
} from "@/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "@/lib/alpaca/safety";
import type { AiAction, AiDecision, RiskStatus } from "@/lib/alpaca/types";
import { generateWatchlistDecisions } from "@/lib/ai/decision";
import {
  getAlpacaCredentials,
  getMaxDailyPaperTrades,
  getMaxNotionalPerTrade,
  getSmallAccountConfig,
  isPaperOrderExecutionEnabled,
  isSmallAccountMode,
  type OrderMode,
} from "@/lib/config";
import { assessDataQuality } from "@/lib/market/data-quality";
import { SMALL_ACCOUNT_WARNINGS } from "@/lib/stocks/small-account";
import {
  appendPaperTradeLog,
  countDailyPaperTrades,
} from "@/lib/trades/daily-limit";
import { actionToSide, evaluateOrderGates } from "@/lib/trades/gates";
import type {
  PaperOrderPreview,
  PaperOrderPreviewRequest,
  PaperOrderSide,
  PaperOrderSubmitRequest,
  PaperOrderSubmitResult,
} from "@/lib/trades/types";
import {
  fetchMarketCondition,
  fetchMultiTimeframeBars,
} from "@/lib/stocks/fetch-context";

function estimatePrice(input: {
  side: PaperOrderSide;
  bid: number | null;
  ask: number | null;
  last: number | null;
}): number | null {
  if (input.side === "buy" && input.ask != null && input.ask > 0) {
    return input.ask;
  }
  if (input.side === "sell" && input.bid != null && input.bid > 0) {
    return input.bid;
  }
  if (input.last != null && input.last > 0) return input.last;
  if (input.ask != null && input.bid != null && input.ask > 0 && input.bid > 0) {
    return (input.ask + input.bid) / 2;
  }
  return null;
}

function parseSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

function paperEndpointOk(): boolean {
  try {
    const { baseUrl } = getAlpacaCredentials();
    assertPaperTradingOnly(baseUrl);
    return true;
  } catch {
    return false;
  }
}

function resolveSizing(input: {
  orderMode: OrderMode;
  qty?: number;
  notional?: number;
  estimatedPrice: number | null;
}): {
  qty: number;
  notional: number | null;
  estimatedShares: number | null;
  estimatedNotional: number | null;
} {
  if (input.orderMode === "notional") {
    const notional = Number(input.notional);
    const estimatedShares =
      input.estimatedPrice != null && input.estimatedPrice > 0
        ? Number((notional / input.estimatedPrice).toFixed(6))
        : null;
    return {
      qty: estimatedShares != null ? Math.max(0, estimatedShares) : 0,
      notional,
      estimatedShares,
      estimatedNotional: notional,
    };
  }

  const qty = Math.floor(Number(input.qty));
  const estimatedNotional =
    input.estimatedPrice != null && qty > 0
      ? input.estimatedPrice * qty
      : null;
  return {
    qty,
    notional: null,
    estimatedShares: null,
    estimatedNotional,
  };
}

async function resolveDecisionContext(input: {
  symbol: string;
  side: PaperOrderSide;
  action?: AiAction;
  riskStatus?: RiskStatus;
}): Promise<{
  action: AiAction;
  riskStatus: RiskStatus;
  decision: AiDecision | null;
  dataQuality: ReturnType<typeof assessDataQuality>;
  estimatedPrice: number | null;
}> {
  const symbol = parseSymbol(input.symbol);
  const [clock, quotes, latestBars, multiBars, marketCondition] =
    await Promise.all([
      getMarketClock(),
      getLatestQuotes([symbol]),
      getLatestBars([symbol]),
      fetchMultiTimeframeBars([symbol]),
      fetchMarketCondition(),
    ]);

  const quote = quotes[0];
  const bars = multiBars.bars5Min[symbol] ?? [];
  const dataQuality = assessDataQuality({
    isMarketOpen: clock.isOpen,
    quote,
    bars,
  });

  const decisions = generateWatchlistDecisions({
    symbols: [symbol],
    quotes,
    barsBySymbol: multiBars.bars5Min,
    bars1MinBySymbol: multiBars.bars1Min,
    bars5MinBySymbol: multiBars.bars5Min,
    bars15MinBySymbol: multiBars.bars15Min,
    timeframe: "5Min",
    isMarketOpen: clock.isOpen,
    marketCondition,
  });
  const decision = decisions[0] ?? null;

  const action: AiAction = input.action ?? decision?.action ?? "HOLD";
  const riskStatus: RiskStatus =
    input.riskStatus ?? decision?.riskStatus ?? "unknown";

  const last = latestBars[symbol]?.close ?? null;
  const estimatedPrice = estimatePrice({
    side: input.side,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    last,
  });

  return {
    action,
    riskStatus,
    decision,
    dataQuality,
    estimatedPrice,
  };
}

function toPreview(input: {
  symbol: string;
  side: PaperOrderSide;
  orderMode: OrderMode;
  qty: number;
  notional: number | null;
  estimatedShares: number | null;
  estimatedNotional: number | null;
  action: AiAction;
  riskStatus: RiskStatus;
  estimatedPrice: number | null;
  dataQuality: ReturnType<typeof assessDataQuality>;
  executionEnabled: boolean;
  endpointOk: boolean;
  maxNotional: number;
  maxDaily: number;
  dailyUsed: number;
  requireManualApproval: boolean;
  manualApproved?: boolean;
  confirmed?: boolean;
}): PaperOrderPreview {
  const gates = evaluateOrderGates({
    executionEnabled: input.executionEnabled,
    paperEndpointOk: input.endpointOk,
    action: input.action,
    side: input.side,
    riskStatus: input.riskStatus,
    dataQuality: input.dataQuality,
    orderMode: input.orderMode,
    qty: input.qty,
    notional: input.notional,
    estimatedPrice: input.estimatedPrice,
    maxNotional: input.maxNotional,
    dailyTradeCount: input.dailyUsed,
    maxDailyTrades: input.maxDaily,
    requireManualApproval: input.requireManualApproval,
    manualApproved: input.manualApproved,
    confirmed: input.confirmed,
  });

  const canPrepare =
    (input.action === "BUY" || input.action === "SELL") &&
    actionToSide(input.action) === input.side;

  const smallAccount = isSmallAccountMode();

  return {
    paperOnly: true,
    warning: "PAPER TRADE ONLY",
    symbol: input.symbol,
    side: input.side,
    orderMode: input.orderMode,
    qty: input.qty,
    notional: input.notional,
    estimatedShares: input.estimatedShares,
    orderType: "market",
    timeInForce: "day",
    estimatedPrice: input.estimatedPrice,
    estimatedNotional: input.estimatedNotional,
    maxNotional: input.maxNotional,
    maxDailyPaperTrades: input.maxDaily,
    dailyPaperTradesUsed: input.dailyUsed,
    action: input.action,
    riskStatus: input.riskStatus,
    executionEnabled: input.executionEnabled,
    gates,
    canPrepare,
    canSubmit: gates.allowed,
    smallAccountMode: smallAccount,
    smallAccountWarnings: smallAccount ? [...SMALL_ACCOUNT_WARNINGS] : [],
  };
}

export async function buildPaperOrderPreview(
  request: PaperOrderPreviewRequest,
): Promise<PaperOrderPreview> {
  const symbol = parseSymbol(request.symbol);
  const side = request.side;
  const orderMode = request.orderMode;
  const executionEnabled = isPaperOrderExecutionEnabled();
  const maxNotional = getMaxNotionalPerTrade();
  const maxDaily = getMaxDailyPaperTrades();
  const dailyUsed = await countDailyPaperTrades();
  const endpointOk = paperEndpointOk();

  const ctx = await resolveDecisionContext({
    symbol,
    side,
    action: request.action,
    riskStatus: request.riskStatus,
  });

  const sizing = resolveSizing({
    orderMode,
    qty: request.qty,
    notional: request.notional,
    estimatedPrice: ctx.estimatedPrice,
  });

  return toPreview({
    symbol,
    side,
    orderMode,
    qty: sizing.qty,
    notional: sizing.notional,
    estimatedShares: sizing.estimatedShares,
    estimatedNotional: sizing.estimatedNotional,
    action: ctx.action,
    riskStatus: ctx.riskStatus,
    estimatedPrice: ctx.estimatedPrice,
    dataQuality: ctx.dataQuality,
    executionEnabled,
    endpointOk,
    maxNotional,
    maxDaily,
    dailyUsed,
    requireManualApproval: false,
  });
}

export async function submitManualPaperOrder(
  request: PaperOrderSubmitRequest,
): Promise<PaperOrderSubmitResult> {
  const symbol = parseSymbol(request.symbol);
  const side = request.side;
  const orderMode = request.orderMode;
  const executionEnabled = isPaperOrderExecutionEnabled();
  const maxNotional = getMaxNotionalPerTrade();
  const maxDaily = getMaxDailyPaperTrades();
  const dailyUsed = await countDailyPaperTrades();
  const endpointOk = paperEndpointOk();

  const ctx = await resolveDecisionContext({
    symbol,
    side,
    action: request.action,
    riskStatus: request.riskStatus,
  });

  const sizing = resolveSizing({
    orderMode,
    qty: request.qty,
    notional: request.notional,
    estimatedPrice: ctx.estimatedPrice,
  });

  const preview = toPreview({
    symbol,
    side,
    orderMode,
    qty: sizing.qty,
    notional: sizing.notional,
    estimatedShares: sizing.estimatedShares,
    estimatedNotional: sizing.estimatedNotional,
    action: ctx.action,
    riskStatus: ctx.riskStatus,
    estimatedPrice: ctx.estimatedPrice,
    dataQuality: ctx.dataQuality,
    executionEnabled,
    endpointOk,
    maxNotional,
    maxDaily,
    dailyUsed,
    requireManualApproval: true,
    manualApproved: request.manualApproval === true,
    confirmed: request.confirmed === true,
  });

  if (!preview.gates.allowed) {
    return {
      paperOnly: true,
      warning: "PAPER TRADE ONLY",
      submitted: false,
      order: null,
      preview,
      error: preview.gates.blockers.map((b) => b.message).join(" "),
    };
  }

  try {
    const order =
      orderMode === "notional" && sizing.notional != null
        ? await placePaperOrder({
            symbol,
            notional: sizing.notional,
            side,
            type: "market",
            time_in_force: "day",
          })
        : await placePaperOrder({
            symbol,
            qty: sizing.qty,
            side,
            type: "market",
            time_in_force: "day",
          });

    await appendPaperTradeLog({
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty ? Number(order.qty) : sizing.qty,
      notional: sizing.notional,
      submittedAt: order.submitted_at || new Date().toISOString(),
    });

    return {
      paperOnly: true,
      warning: "PAPER TRADE ONLY",
      submitted: true,
      order: {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        qty: order.qty,
        notional:
          orderMode === "notional" && sizing.notional != null
            ? String(sizing.notional)
            : null,
        status: order.status,
        submittedAt: order.submitted_at,
        filledAvgPrice: order.filled_avg_price,
      },
      preview,
    };
  } catch (error) {
    const message =
      error instanceof PaperTradingSafetyError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to submit paper order";
    return {
      paperOnly: true,
      warning: "PAPER TRADE ONLY",
      submitted: false,
      order: null,
      preview,
      error: message,
    };
  }
}

/** Expose read-only small account config for API/UI (no secrets). */
export function getPaperOrderSmallAccountMeta() {
  return getSmallAccountConfig();
}
