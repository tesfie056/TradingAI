/**
 * Version 1 paper trade lifecycle — types and ownership.
 *
 * Ownership:
 * - v1_managed: opened by v1-simple-long with local trade record + client_order_id
 * - legacy: known pre-existing / manual (e.g. AAPL short) — never auto-managed
 * - external: broker position with no V1 record
 * - orphaned: open position without protective orders
 * - unknown: reconcile could not classify safely
 */

export type V1OwnershipStatus =
  | "v1_managed"
  | "legacy"
  | "external"
  | "orphaned"
  | "unknown";

/**
 * Explicit lifecycle states. Illegal transitions are rejected.
 * COMPLETED requires confirmed exit fill with zero remaining quantity.
 */
export type V1LifecycleState =
  | "CANDIDATE_SELECTED"
  | "ENTRY_PENDING"
  | "ENTRY_ACCEPTED"
  | "ENTRY_PARTIALLY_FILLED"
  | "ENTRY_FILLED"
  | "PROTECTION_PENDING"
  | "POSITION_OPEN"
  | "EXIT_PENDING"
  | "EXIT_ACCEPTED"
  | "EXIT_PARTIALLY_FILLED"
  | "EXIT_FILLED"
  | "COMPLETED"
  | "ENTRY_REJECTED"
  | "ENTRY_CANCELED"
  | "EXIT_REJECTED"
  | "EXIT_CANCELED"
  | "RECONCILIATION_REQUIRED"
  | "MANUAL_INTERVENTION_REQUIRED";

export type V1ExitReason =
  | "TAKE_PROFIT_FILLED"
  | "STOP_LOSS_FILLED"
  | "MAX_HOLD_TIME"
  | "END_OF_DAY_EXIT"
  | "STRATEGY_SAFETY_EXIT"
  | "EMERGENCY_OPERATOR_EXIT"
  | "MANUAL_OPERATOR_EXIT"
  | "BROKER_FORCED_EXIT"
  | "RECONCILIATION_CORRECTION";

export type V1StateTransition = {
  from: V1LifecycleState;
  to: V1LifecycleState;
  at: string;
  reason: string;
};

export type V1LifecycleTrade = {
  tradeId: string;
  strategyId: string;
  strategyVersion: string;
  scanId: string | null;
  decisionId: string | null;
  entryDecisionId: string | null;
  symbol: string;
  side: "long";
  ownership: "v1_managed";
  clientOrderId: string;
  requestedQty: number;
  filledEntryQty: number;
  remainingQty: number;
  plannedEntry: number | null;
  actualAvgEntry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  expectedRisk: number | null;
  rewardToRisk: number | null;
  entryOrderId: string | null;
  stopOrderId: string | null;
  takeProfitOrderId: string | null;
  exitOrderIds: string[];
  lifecycleState: V1LifecycleState;
  transitions: V1StateTransition[];
  entryRejectionReason: string | null;
  exitRejectionReason: string | null;
  exitReason: V1ExitReason | null;
  protectionStatus: "unknown" | "pending" | "active" | "missing" | "partial";
  realizedGrossPnL: number | null;
  realizedNetPnL: number | null;
  fees: number | null;
  holdingDurationMs: number | null;
  avgExitPrice: number | null;
  filledExitQty: number;
  createdAt: string;
  updatedAt: string;
  entrySubmittedAt: string | null;
  entryFilledAt: string | null;
  exitSubmittedAt: string | null;
  exitFilledAt: string | null;
  completedAt: string | null;
  lastReconciledAt: string | null;
  lastBrokerUpdateAt: string | null;
  paperOnly: true;
  criticalWarnings: string[];
};

export type V1PositionClassification = {
  symbol: string;
  qty: number;
  side: "long" | "short" | "flat";
  avgEntry: number | null;
  ownership: V1OwnershipStatus;
  tradeId: string | null;
  protectionStatus: "unknown" | "active" | "missing" | "n/a";
  blocksV1Buy: boolean;
  reason: string;
  /** True when this is the known legacy AAPL short — never auto-modified. */
  isLegacyAaplShort: boolean;
};

export type V1LifecycleWarning = {
  level: "info" | "warn" | "critical";
  code: string;
  message: string;
  symbol?: string;
  tradeId?: string;
};
