/**
 * Phase H — conservative paper soak-test profile constants.
 * Active flag comes from runtime settings (env seeds default).
 * Lazy-reads settings to avoid circular imports with defaults seeding.
 */

export const PAPER_SOAK_PROFILE_NAME = "conservative-paper-soak-v1";

/** Exact limits for controlled paper soak testing. */
export const PAPER_SOAK_DEFAULTS = {
  maxOpenPositions: 1,
  maxDailyPaperTrades: 2,
  maxRiskPerTradePct: 0.25,
  maxPositionAllocationPct: 5,
  maxDailyLossPct: 1,
  openEntryDelayMinutes: 15,
  eodEntryCutoffMinutes: 45,
  regularHoursOnly: true,
  longOnly: true,
  allowSellAuto: false,
} as const;

export function isPaperSoakProfileEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@/lib/auto-trade/runtime-settings/service") as typeof import("@/lib/auto-trade/runtime-settings/service");
    return mod.getEffectiveRuntimeSettings().paperSoakProfile;
  } catch {
    return process.env.PAPER_SOAK_PROFILE === "true";
  }
}

export function getPaperSoakProfileSummary() {
  return {
    name: PAPER_SOAK_PROFILE_NAME,
    enabled: isPaperSoakProfileEnabled(),
    paperOnly: true as const,
    liveTradingAllowed: false as const,
    ...PAPER_SOAK_DEFAULTS,
  };
}
