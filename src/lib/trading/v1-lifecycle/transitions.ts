/**
 * Explicit Version 1 lifecycle state machine.
 * Illegal transitions throw. Every transition is timestamped.
 */

import type {
  V1LifecycleState,
  V1LifecycleTrade,
  V1StateTransition,
} from "@/lib/trading/v1-lifecycle/types";

const ALLOWED: Record<V1LifecycleState, readonly V1LifecycleState[]> = {
  CANDIDATE_SELECTED: [
    "ENTRY_PENDING",
    "ENTRY_REJECTED",
    "RECONCILIATION_REQUIRED",
    "MANUAL_INTERVENTION_REQUIRED",
  ],
  ENTRY_PENDING: [
    "ENTRY_ACCEPTED",
    "ENTRY_PARTIALLY_FILLED",
    "ENTRY_FILLED",
    "ENTRY_REJECTED",
    "ENTRY_CANCELED",
    "RECONCILIATION_REQUIRED",
  ],
  ENTRY_ACCEPTED: [
    "ENTRY_PARTIALLY_FILLED",
    "ENTRY_FILLED",
    "ENTRY_CANCELED",
    "ENTRY_REJECTED",
    "RECONCILIATION_REQUIRED",
  ],
  ENTRY_PARTIALLY_FILLED: [
    "ENTRY_FILLED",
    "ENTRY_CANCELED",
    "PROTECTION_PENDING",
    "POSITION_OPEN",
    "MANUAL_INTERVENTION_REQUIRED",
    "RECONCILIATION_REQUIRED",
  ],
  ENTRY_FILLED: [
    "PROTECTION_PENDING",
    "POSITION_OPEN",
    "EXIT_PENDING",
    "EXIT_PARTIALLY_FILLED",
    "EXIT_FILLED",
    "MANUAL_INTERVENTION_REQUIRED",
    "RECONCILIATION_REQUIRED",
  ],
  PROTECTION_PENDING: [
    "POSITION_OPEN",
    "EXIT_PENDING",
    "EXIT_PARTIALLY_FILLED",
    "EXIT_FILLED",
    "MANUAL_INTERVENTION_REQUIRED",
    "RECONCILIATION_REQUIRED",
  ],
  POSITION_OPEN: [
    "EXIT_PENDING",
    "EXIT_ACCEPTED",
    "EXIT_PARTIALLY_FILLED",
    "EXIT_FILLED",
    "MANUAL_INTERVENTION_REQUIRED",
    "RECONCILIATION_REQUIRED",
  ],
  EXIT_PENDING: [
    "EXIT_ACCEPTED",
    "EXIT_PARTIALLY_FILLED",
    "EXIT_FILLED",
    "EXIT_REJECTED",
    "EXIT_CANCELED",
    "POSITION_OPEN",
    "RECONCILIATION_REQUIRED",
  ],
  EXIT_ACCEPTED: [
    "EXIT_PARTIALLY_FILLED",
    "EXIT_FILLED",
    "EXIT_CANCELED",
    "EXIT_REJECTED",
    "RECONCILIATION_REQUIRED",
  ],
  EXIT_PARTIALLY_FILLED: [
    "EXIT_FILLED",
    "EXIT_PENDING",
    "POSITION_OPEN",
    "MANUAL_INTERVENTION_REQUIRED",
    "RECONCILIATION_REQUIRED",
  ],
  EXIT_FILLED: ["COMPLETED", "RECONCILIATION_REQUIRED"],
  COMPLETED: [],
  ENTRY_REJECTED: ["RECONCILIATION_REQUIRED"],
  ENTRY_CANCELED: ["RECONCILIATION_REQUIRED", "POSITION_OPEN"],
  EXIT_REJECTED: [
    "POSITION_OPEN",
    "MANUAL_INTERVENTION_REQUIRED",
    "RECONCILIATION_REQUIRED",
  ],
  EXIT_CANCELED: [
    "POSITION_OPEN",
    "EXIT_PENDING",
    "MANUAL_INTERVENTION_REQUIRED",
    "RECONCILIATION_REQUIRED",
  ],
  RECONCILIATION_REQUIRED: [
    "ENTRY_PENDING",
    "ENTRY_ACCEPTED",
    "ENTRY_PARTIALLY_FILLED",
    "ENTRY_FILLED",
    "PROTECTION_PENDING",
    "POSITION_OPEN",
    "EXIT_PENDING",
    "EXIT_ACCEPTED",
    "EXIT_PARTIALLY_FILLED",
    "EXIT_FILLED",
    "COMPLETED",
    "ENTRY_REJECTED",
    "ENTRY_CANCELED",
    "EXIT_REJECTED",
    "EXIT_CANCELED",
    "MANUAL_INTERVENTION_REQUIRED",
  ],
  MANUAL_INTERVENTION_REQUIRED: [
    "POSITION_OPEN",
    "EXIT_PENDING",
    "EXIT_PARTIALLY_FILLED",
    "EXIT_FILLED",
    "COMPLETED",
    "RECONCILIATION_REQUIRED",
  ],
};

export function canTransition(
  from: V1LifecycleState,
  to: V1LifecycleState,
): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export function assertTransition(
  from: V1LifecycleState,
  to: V1LifecycleState,
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal V1 lifecycle transition: ${from} → ${to}`);
  }
}

export function applyTransition(
  trade: V1LifecycleTrade,
  to: V1LifecycleState,
  reason: string,
  at = new Date().toISOString(),
): V1LifecycleTrade {
  assertTransition(trade.lifecycleState, to);
  if (trade.lifecycleState === to) {
    return {
      ...trade,
      updatedAt: at,
      transitions: [
        ...trade.transitions,
        { from: trade.lifecycleState, to, at, reason: `noop: ${reason}` },
      ],
    };
  }
  const transition: V1StateTransition = {
    from: trade.lifecycleState,
    to,
    at,
    reason,
  };
  return {
    ...trade,
    lifecycleState: to,
    updatedAt: at,
    transitions: [...trade.transitions, transition],
  };
}

/** Terminal states that are not actively monitored for new exits. */
export function isTerminalState(state: V1LifecycleState): boolean {
  return state === "COMPLETED" || state === "ENTRY_REJECTED";
}

export function isOpenManagedState(state: V1LifecycleState): boolean {
  return [
    "ENTRY_PARTIALLY_FILLED",
    "ENTRY_FILLED",
    "PROTECTION_PENDING",
    "POSITION_OPEN",
    "EXIT_PENDING",
    "EXIT_ACCEPTED",
    "EXIT_PARTIALLY_FILLED",
  ].includes(state);
}
