/**
 * Version 1 lifecycle configuration — paper round-trip only.
 * Conservative defaults; not tuned for trade frequency.
 */

export const V1_LIFECYCLE_STRATEGY_ID = "v1-simple-long" as const;

export type V1LifecycleConfig = {
  /** Maximum minutes a Version 1 long may stay open before timed exit. */
  maxHoldMinutes: number;
  /** Cancel unfilled V1 entry after this many minutes. */
  entryOrderTimeoutMinutes: number;
  /**
   * When minutes until regular close ≤ this value, pause new entries and
   * begin flattening Version 1-owned positions (END_OF_DAY_EXIT).
   * Kept shorter than typical entry cutoff so entries stop earlier.
   */
  eodFlattenMinutes: number;
  /** Minimum reward-to-risk for new entries. */
  minRewardToRisk: number;
  /** Prefix for Alpaca client_order_id (must stay within 48 chars total). */
  clientOrderIdPrefix: string;
};

/**
 * Defaults:
 * - maxHold 90m — intraday swing within one session, not a 3-trade forced cycle
 * - entry timeout 5m — avoid resting unfilled day orders
 * - eod flatten 15m before close — leave time to fill before the close
 */
export const V1_LIFECYCLE_CONFIG: V1LifecycleConfig = {
  maxHoldMinutes: 90,
  entryOrderTimeoutMinutes: 5,
  eodFlattenMinutes: 15,
  minRewardToRisk: 1.5,
  clientOrderIdPrefix: "v1",
};

export function getV1LifecycleConfig(): V1LifecycleConfig {
  return { ...V1_LIFECYCLE_CONFIG };
}
