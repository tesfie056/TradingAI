/**
 * Server-side validation for runtime auto-trade settings.
 * Never trust the frontend alone.
 */

import { parseConfigurableWatchlist } from "@/lib/universe/paper-soak-watchlist";
import { DEFAULT_PAPER_SOAK_WATCHLIST } from "@/lib/universe/paper-soak-watchlist";
import type {
  AutoTradeRuntimeSettings,
  RuntimeSettingsPatch,
} from "@/lib/auto-trade/runtime-settings/types";

export type SettingsValidationResult =
  | { ok: true; normalized: RuntimeSettingsPatch }
  | { ok: false; errors: string[] };

const RISK_PCT_MIN = 0.05;
const RISK_PCT_MAX = 2;
const ALLOC_PCT_MAX = 25;
const DAILY_LOSS_PCT_MAX = 5;
const OPEN_INTERVAL_MIN_MS = 60_000;
const CLOSED_INTERVAL_MIN_MS = 60_000;
const REGULAR_SESSION_MINUTES = 390;

function asNumber(v: unknown, field: string, errors: string[]): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    errors.push(`${field} must be a number`);
    return null;
  }
  return n;
}

/**
 * Validate a partial patch against current settings (merged preview).
 */
export function validateRuntimeSettingsPatch(
  current: AutoTradeRuntimeSettings,
  patch: RuntimeSettingsPatch,
): SettingsValidationResult {
  const errors: string[] = [];
  const normalized: RuntimeSettingsPatch = {};

  // Reject attempts to unlock safety
  const lockedKeys = [
    "paperOnly",
    "liveTradingAllowed",
    "riskEngineRequired",
    "bracketsRequired",
  ] as const;
  for (const k of lockedKeys) {
    if (k in (patch as object)) {
      errors.push(`${k} is locked and cannot be changed`);
    }
  }

  if (patch.executionEnabled !== undefined) {
    if (typeof patch.executionEnabled !== "boolean") {
      errors.push("executionEnabled must be boolean");
    } else normalized.executionEnabled = patch.executionEnabled;
  }
  if (patch.autoTradingEnabled !== undefined) {
    if (typeof patch.autoTradingEnabled !== "boolean") {
      errors.push("autoTradingEnabled must be boolean");
    } else normalized.autoTradingEnabled = patch.autoTradingEnabled;
  }

  const merge = { ...current, ...patch };

  if (patch.maxOpenPositions !== undefined) {
    const n = asNumber(patch.maxOpenPositions, "maxOpenPositions", errors);
    if (n != null) {
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        errors.push("maxOpenPositions must be an integer from 1 to 20");
      } else normalized.maxOpenPositions = n;
    }
  }

  if (patch.maxTradesPerDay !== undefined) {
    const n = asNumber(patch.maxTradesPerDay, "maxTradesPerDay", errors);
    if (n != null) {
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        errors.push("maxTradesPerDay must be an integer from 1 to 50");
      } else normalized.maxTradesPerDay = n;
    }
  }

  if (patch.maxRiskPerTradePct !== undefined) {
    const n = asNumber(patch.maxRiskPerTradePct, "maxRiskPerTradePct", errors);
    if (n != null) {
      if (n < RISK_PCT_MIN || n > RISK_PCT_MAX) {
        errors.push(
          `maxRiskPerTradePct must be between ${RISK_PCT_MIN} and ${RISK_PCT_MAX}`,
        );
      } else normalized.maxRiskPerTradePct = n;
    }
  }

  if (patch.maxPositionAllocationPct !== undefined) {
    const n = asNumber(
      patch.maxPositionAllocationPct,
      "maxPositionAllocationPct",
      errors,
    );
    if (n != null) {
      if (n <= 0 || n > ALLOC_PCT_MAX) {
        errors.push(`maxPositionAllocationPct must be > 0 and ≤ ${ALLOC_PCT_MAX}`);
      } else normalized.maxPositionAllocationPct = n;
    }
  }

  if (patch.maxDailyLossPct !== undefined) {
    const n = asNumber(patch.maxDailyLossPct, "maxDailyLossPct", errors);
    if (n != null) {
      if (n <= 0 || n > DAILY_LOSS_PCT_MAX) {
        errors.push(`maxDailyLossPct must be > 0 and ≤ ${DAILY_LOSS_PCT_MAX}`);
      } else normalized.maxDailyLossPct = n;
    }
  }

  const riskPct = merge.maxRiskPerTradePct;
  const dailyLoss = merge.maxDailyLossPct;
  if (dailyLoss <= riskPct) {
    errors.push("maxDailyLossPct must be greater than maxRiskPerTradePct");
  }

  if (patch.consecutiveLossPause !== undefined) {
    const n = asNumber(
      patch.consecutiveLossPause,
      "consecutiveLossPause",
      errors,
    );
    if (n != null) {
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        errors.push("consecutiveLossPause must be an integer from 1 to 20");
      } else normalized.consecutiveLossPause = n;
    }
  }

  if (patch.longOnly !== undefined) {
    if (typeof patch.longOnly !== "boolean") errors.push("longOnly must be boolean");
    else {
      if (patch.longOnly === false) {
        // Shorting not supported in this paper stage — reject enabling shorts
        errors.push(
          "Short selling cannot be enabled — strategy stage is long-only",
        );
      } else normalized.longOnly = true;
    }
  }

  if (patch.regularHoursOnly !== undefined) {
    if (typeof patch.regularHoursOnly !== "boolean") {
      errors.push("regularHoursOnly must be boolean");
    } else normalized.regularHoursOnly = patch.regularHoursOnly;
  }

  if (patch.openEntryDelayMinutes !== undefined) {
    const n = asNumber(
      patch.openEntryDelayMinutes,
      "openEntryDelayMinutes",
      errors,
    );
    if (n != null) {
      if (!Number.isInteger(n) || n < 0 || n > 120) {
        errors.push("openEntryDelayMinutes must be an integer from 0 to 120");
      } else normalized.openEntryDelayMinutes = n;
    }
  }

  if (patch.eodEntryCutoffMinutes !== undefined) {
    const n = asNumber(
      patch.eodEntryCutoffMinutes,
      "eodEntryCutoffMinutes",
      errors,
    );
    if (n != null) {
      if (!Number.isInteger(n) || n < 0 || n > 180) {
        errors.push("eodEntryCutoffMinutes must be an integer from 0 to 180");
      } else normalized.eodEntryCutoffMinutes = n;
    }
  }

  const openDelay = merge.openEntryDelayMinutes;
  const eodCut = merge.eodEntryCutoffMinutes;
  if (openDelay + eodCut >= REGULAR_SESSION_MINUTES - 30) {
    errors.push(
      "openEntryDelayMinutes + eodEntryCutoffMinutes leave no valid trading window",
    );
  }

  if (patch.scanIntervalOpenMs !== undefined) {
    const n = asNumber(patch.scanIntervalOpenMs, "scanIntervalOpenMs", errors);
    if (n != null) {
      if (!Number.isInteger(n) || n < OPEN_INTERVAL_MIN_MS) {
        errors.push(
          `scanIntervalOpenMs must be an integer ≥ ${OPEN_INTERVAL_MIN_MS}`,
        );
      } else normalized.scanIntervalOpenMs = n;
    }
  }

  if (patch.scanIntervalClosedMs !== undefined) {
    const n = asNumber(
      patch.scanIntervalClosedMs,
      "scanIntervalClosedMs",
      errors,
    );
    if (n != null) {
      if (!Number.isInteger(n) || n < CLOSED_INTERVAL_MIN_MS) {
        errors.push(
          `scanIntervalClosedMs must be an integer ≥ ${CLOSED_INTERVAL_MIN_MS}`,
        );
      } else normalized.scanIntervalClosedMs = n;
    }
  }

  if (patch.paperSoakProfile !== undefined) {
    if (typeof patch.paperSoakProfile !== "boolean") {
      errors.push("paperSoakProfile must be boolean");
    } else normalized.paperSoakProfile = patch.paperSoakProfile;
  }

  if (patch.watchlist !== undefined) {
    const raw = Array.isArray(patch.watchlist)
      ? patch.watchlist.join(",")
      : String(patch.watchlist);
    const list = parseConfigurableWatchlist(raw, DEFAULT_PAPER_SOAK_WATCHLIST);
    if (list.length === 0) {
      errors.push("watchlist must contain at least one valid US equity symbol");
    } else {
      normalized.watchlist = list;
    }
  }

  if (patch.minPrice !== undefined) {
    const n = asNumber(patch.minPrice, "minPrice", errors);
    if (n != null) {
      if (n < 1 || n > 500) errors.push("minPrice out of allowed range");
      else normalized.minPrice = n;
    }
  }
  if (patch.maxPrice !== undefined) {
    const n = asNumber(patch.maxPrice, "maxPrice", errors);
    if (n != null) {
      if (n < 1 || n > 1000) errors.push("maxPrice out of allowed range");
      else normalized.maxPrice = n;
    }
  }
  if (merge.minPrice >= merge.maxPrice) {
    errors.push("minPrice must be lower than maxPrice");
  }

  if (patch.minAvgDailyVolume !== undefined) {
    const n = asNumber(patch.minAvgDailyVolume, "minAvgDailyVolume", errors);
    if (n != null) {
      if (!Number.isInteger(n) || n < 0) {
        errors.push("minAvgDailyVolume must be a non-negative integer");
      } else normalized.minAvgDailyVolume = n;
    }
  }

  if (patch.maxSpreadPercent !== undefined) {
    const n = asNumber(patch.maxSpreadPercent, "maxSpreadPercent", errors);
    if (n != null) {
      if (n <= 0 || n > 5) {
        errors.push("maxSpreadPercent must be > 0 and ≤ 5");
      } else normalized.maxSpreadPercent = n;
    }
  }

  if (patch.excludeLeveragedInverseEtfs !== undefined) {
    if (typeof patch.excludeLeveragedInverseEtfs !== "boolean") {
      errors.push("excludeLeveragedInverseEtfs must be boolean");
    } else {
      normalized.excludeLeveragedInverseEtfs = patch.excludeLeveragedInverseEtfs;
    }
  }

  if (patch.minEligibleSymbols !== undefined) {
    const n = asNumber(patch.minEligibleSymbols, "minEligibleSymbols", errors);
    if (n != null) {
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        errors.push("minEligibleSymbols must be an integer from 1 to 50");
      } else normalized.minEligibleSymbols = n;
    }
  }

  if (patch.allowSellAuto !== undefined) {
    if (typeof patch.allowSellAuto !== "boolean") {
      errors.push("allowSellAuto must be boolean");
    } else normalized.allowSellAuto = patch.allowSellAuto;
  }

  if (patch.minConfidence !== undefined) {
    const n = asNumber(patch.minConfidence, "minConfidence", errors);
    if (n != null) {
      const c = n > 1 ? n / 100 : n;
      if (c <= 0 || c > 1) errors.push("minConfidence must be between 0 and 1");
      else normalized.minConfidence = c;
    }
  }

  if (patch.cooldownMinutes !== undefined) {
    const n = asNumber(patch.cooldownMinutes, "cooldownMinutes", errors);
    if (n != null) {
      if (!Number.isInteger(n) || n < 1 || n > 1440) {
        errors.push("cooldownMinutes must be an integer from 1 to 1440");
      } else normalized.cooldownMinutes = n;
    }
  }

  if (patch.defaultStopLossPct !== undefined) {
    const n = asNumber(patch.defaultStopLossPct, "defaultStopLossPct", errors);
    if (n != null) {
      if (n <= 0 || n > 20) errors.push("defaultStopLossPct out of range");
      else normalized.defaultStopLossPct = n;
    }
  }
  if (patch.defaultTakeProfitPct !== undefined) {
    const n = asNumber(
      patch.defaultTakeProfitPct,
      "defaultTakeProfitPct",
      errors,
    );
    if (n != null) {
      if (n <= 0 || n > 50) errors.push("defaultTakeProfitPct out of range");
      else normalized.defaultTakeProfitPct = n;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, normalized };
}
