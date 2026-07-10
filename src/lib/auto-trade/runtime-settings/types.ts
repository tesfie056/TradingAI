/**
 * Runtime auto-trade settings types.
 * Paper only — live trading never unlocked here.
 */

export type AutoTradeEngineState =
  | "STOPPED"
  | "PAUSED"
  | "SCANNING_ONLY"
  | "AUTO_TRADING"
  | "EMERGENCY_STOPPED"
  | "DAILY_LIMIT_REACHED"
  | "MARKET_CLOSED";

export type SettingSource = "env_default" | "runtime" | "locked";

export type AutoTradeRuntimeSettings = {
  configVersion: number;
  updatedAt: string;
  paperOnly: true;
  liveTradingAllowed: false;
  /** Risk engine always on — not user-toggleable. */
  riskEngineRequired: true;
  /** Bracket SL/TP always required — not user-toggleable. */
  bracketsRequired: true;

  executionEnabled: boolean;
  autoTradingEnabled: boolean;

  maxOpenPositions: number;
  maxTradesPerDay: number;
  maxRiskPerTradePct: number;
  maxPositionAllocationPct: number;
  maxDailyLossPct: number;
  consecutiveLossPause: number;
  longOnly: boolean;
  regularHoursOnly: boolean;
  openEntryDelayMinutes: number;
  eodEntryCutoffMinutes: number;

  scanIntervalOpenMs: number;
  scanIntervalClosedMs: number;

  paperSoakProfile: boolean;
  watchlist: string[];

  minPrice: number;
  maxPrice: number;
  minAvgDailyVolume: number;
  maxSpreadPercent: number;
  excludeLeveragedInverseEtfs: boolean;
  minEligibleSymbols: number;

  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  allowSellAuto: boolean;
  minConfidence: number;
  cooldownMinutes: number;
};

export type RuntimeSettingsPatch = Partial<
  Omit<
    AutoTradeRuntimeSettings,
    | "configVersion"
    | "updatedAt"
    | "paperOnly"
    | "liveTradingAllowed"
    | "riskEngineRequired"
    | "bracketsRequired"
  >
>;

export type SettingsAuditEntry = {
  id: string;
  time: string;
  actor: string;
  reason: string | null;
  field: string;
  previousValue: string | number | boolean | string[] | null;
  newValue: string | number | boolean | string[] | null;
  configVersion: number;
  paperOnly: true;
};

export type SettingMeta = {
  key: keyof AutoTradeRuntimeSettings | string;
  label: string;
  group: "risk" | "schedule" | "universe" | "strategy" | "controls" | "locked";
  applyMode: "immediate" | "restart_required" | "locked";
  help: string;
};

export type EngineControlSnapshot = {
  engineState: AutoTradeEngineState;
  executionEnabled: boolean;
  autoTradingEnabled: boolean;
  killSwitchActive: boolean;
  panicStopActive: boolean;
  canScan: boolean;
  canSubmitOrders: boolean;
  blockingReasons: string[];
  effectivelyAutoTrading: boolean;
};
