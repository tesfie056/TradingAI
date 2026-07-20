/**
 * Version 1 paper round-trip lifecycle — public API.
 * Planning + monitoring + gated execution. Never enables live trading.
 */

export {
  V1_LIFECYCLE_CONFIG,
  V1_LIFECYCLE_STRATEGY_ID,
  getV1LifecycleConfig,
} from "@/lib/trading/v1-lifecycle/config";
export type { V1LifecycleConfig } from "@/lib/trading/v1-lifecycle/config";

export type {
  V1LifecycleState,
  V1LifecycleTrade,
  V1ExitReason,
  V1OwnershipStatus,
  V1PositionClassification,
  V1LifecycleWarning,
  V1StateTransition,
} from "@/lib/trading/v1-lifecycle/types";

export {
  canTransition,
  assertTransition,
  applyTransition,
  isTerminalState,
  isOpenManagedState,
} from "@/lib/trading/v1-lifecycle/transitions";

export {
  newTradeId,
  buildClientOrderId,
  isV1ClientOrderId,
  tradeIdFromClientOrderId,
} from "@/lib/trading/v1-lifecycle/client-order-id";

export { createV1CandidateTrade } from "@/lib/trading/v1-lifecycle/factory";

export {
  readV1LifecycleStore,
  writeV1LifecycleStore,
  upsertV1LifecycleTrade,
  getV1LifecycleTrade,
  findOpenV1TradeBySymbol,
  findV1TradeByClientOrderId,
  listActiveV1Trades,
  listCompletedV1Trades,
  replaceV1LifecycleStoreForTests,
} from "@/lib/trading/v1-lifecycle/store";

export {
  classifyPosition,
  hasProtectiveOrders,
  blocksV1BuyForSymbol,
  aaplShortBlocksV1Buy,
} from "@/lib/trading/v1-lifecycle/ownership";

export { verifyProtectiveOrders } from "@/lib/trading/v1-lifecycle/protection";

export {
  mapAlpacaOrderStatus,
  isFillStatus,
  isTerminalFailure,
} from "@/lib/trading/v1-lifecycle/broker-status";

export {
  syncTradeFromBroker,
  applyExitFill,
  finalizeCompleted,
  shouldSkipManualExit,
} from "@/lib/trading/v1-lifecycle/sync";
export type { BrokerSnapshot } from "@/lib/trading/v1-lifecycle/sync";

export {
  selectV1EntryCandidate,
  submitV1BracketEntry,
  getTradeForIdempotentRetry,
} from "@/lib/trading/v1-lifecycle/entry";

export {
  holdingMinutes,
  needsMaxHoldExit,
  needsEodExit,
  isEodFlattenWindow,
  needsEntryTimeoutCancel,
  submitV1ManagedExit,
} from "@/lib/trading/v1-lifecycle/exits";

export { evaluateV1EntryGates } from "@/lib/trading/v1-lifecycle/gates";
export type {
  V1EntryGateInput,
  V1EntryGateResult,
} from "@/lib/trading/v1-lifecycle/gates";

export { tickV1LifecycleMonitor } from "@/lib/trading/v1-lifecycle/monitor";
export type {
  MonitorTickInput,
  MonitorTickResult,
} from "@/lib/trading/v1-lifecycle/monitor";

export { reconcileV1Lifecycle } from "@/lib/trading/v1-lifecycle/reconcile-lifecycle";
export type { LifecycleReconcileReport } from "@/lib/trading/v1-lifecycle/reconcile-lifecycle";

export { runV1LifecycleScanTick } from "@/lib/trading/v1-lifecycle/scan-hook";
