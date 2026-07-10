import type { AiAction, RiskStatus } from "@/lib/alpaca/types";

export type OrderGateCode =
  | "execution_disabled"
  | "live_endpoint"
  | "market_closed"
  | "stale_quote"
  | "wide_spread"
  | "high_risk"
  | "hold_decision"
  | "invalid_side"
  | "invalid_qty"
  | "max_notional"
  | "max_daily_trades"
  | "missing_approval"
  | "missing_price";

export type OrderGateBlocker = {
  code: OrderGateCode;
  message: string;
};

export type OrderGateResult = {
  allowed: boolean;
  blockers: OrderGateBlocker[];
  warnings: string[];
};

export type PaperOrderSide = "buy" | "sell";

export type PaperOrderPreviewRequest = {
  symbol: string;
  side: PaperOrderSide;
  qty: number;
  /** Optional AI action context; HOLD always blocks. */
  action?: AiAction;
  riskStatus?: RiskStatus;
};

export type PaperOrderPreview = {
  paperOnly: true;
  warning: "PAPER TRADE ONLY";
  symbol: string;
  side: PaperOrderSide;
  qty: number;
  orderType: "market";
  timeInForce: "day";
  estimatedPrice: number | null;
  estimatedNotional: number | null;
  maxNotional: number;
  maxDailyPaperTrades: number;
  dailyPaperTradesUsed: number;
  action: AiAction;
  riskStatus: RiskStatus;
  executionEnabled: boolean;
  gates: OrderGateResult;
  canPrepare: boolean;
  canSubmit: boolean;
};

export type PaperOrderSubmitRequest = {
  symbol: string;
  side: PaperOrderSide;
  qty: number;
  action?: AiAction;
  riskStatus?: RiskStatus;
  /** Must be true — manual confirmation required. */
  confirmed: boolean;
  manualApproval: boolean;
};

export type PaperOrderSubmitResult = {
  paperOnly: true;
  warning: "PAPER TRADE ONLY";
  submitted: boolean;
  order: {
    id: string;
    symbol: string;
    side: string;
    type: string;
    qty: string | null;
    status: string;
    submittedAt: string;
    filledAvgPrice: string | null;
  } | null;
  preview: PaperOrderPreview;
  error?: string;
};
