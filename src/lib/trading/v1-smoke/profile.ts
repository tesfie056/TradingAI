/**
 * Stage A supervised paper smoke-test profile.
 * Temporary / scoped — does not permanently change Version 1 defaults.
 */

export const V1_SMOKE_PROFILE_NAME = "v1-stage-a-supervised-smoke" as const;

export const V1_SMOKE_PROFILE = {
  name: V1_SMOKE_PROFILE_NAME,
  paperOnly: true as const,
  liveTradingAllowed: false as const,
  /** Maximum Version 1 open positions during Stage A */
  maxOpenPositions: 1,
  /** Exactly one new entry for Stage A */
  maxNewEntriesForSmokeTest: 1,
  /** Hard notional cap for the smoke BUY */
  maxNotionalUsd: 25,
  /** Max risk per trade as % of equity */
  maxRiskPerTradePct: 0.1,
  /** Soft dollar daily loss cap for smoke day */
  maxDailyLossUsd: 2,
  /** Also keep % daily loss conservative */
  maxDailyLossPct: 0.5,
  openEntryDelayMinutes: 15,
  eodEntryCutoffMinutes: 45,
  eodFlattenMinutes: 15,
  maxHoldMinutes: 90,
  regularHoursOnly: true,
  longOnly: true,
  bracketsRequired: true,
  autoTradingMustRemainOff: true,
  blockAaplWhileLegacyShort: true,
  typedConfirmation: "PAPER SMOKE",
  dailyCompletedTradeTarget: 3,
} as const;

export type V1SmokeProfile = typeof V1_SMOKE_PROFILE;
