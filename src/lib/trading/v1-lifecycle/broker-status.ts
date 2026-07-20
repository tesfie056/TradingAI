/**
 * Map Alpaca order statuses into Version 1 lifecycle intents.
 */

export type BrokerOrderPhase =
  | "submitted"
  | "accepted"
  | "new"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired"
  | "replaced"
  | "pending_cancel"
  | "pending_replace"
  | "unknown";

export function mapAlpacaOrderStatus(
  status: string | null | undefined,
): BrokerOrderPhase {
  const s = (status ?? "").toLowerCase();
  switch (s) {
    case "pending_new":
    case "accepted":
      return s === "pending_new" ? "submitted" : "accepted";
    case "new":
    case "held":
      return "new";
    case "partially_filled":
      return "partially_filled";
    case "filled":
      return "filled";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "rejected":
    case "suspended":
      return "rejected";
    case "expired":
      return "expired";
    case "replaced":
      return "replaced";
    case "pending_cancel":
      return "pending_cancel";
    case "pending_replace":
      return "pending_replace";
    default:
      return "unknown";
  }
}

/** Accepted ≠ filled. */
export function isFillStatus(phase: BrokerOrderPhase): boolean {
  return phase === "filled" || phase === "partially_filled";
}

export function isTerminalFailure(phase: BrokerOrderPhase): boolean {
  return (
    phase === "canceled" ||
    phase === "rejected" ||
    phase === "expired"
  );
}
