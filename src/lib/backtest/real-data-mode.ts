/**
 * Real-data-only validation mode (Milestone I-3).
 */

export function isRealDataOnlyEnv(): boolean {
  const v = process.env.REAL_DATA_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function assertNoSyntheticAllowed(input: {
  realDataOnly: boolean;
  syntheticDataUsed: boolean;
  datasetId: string;
  sources: string[];
}): void {
  if (!input.realDataOnly) return;
  if (input.syntheticDataUsed) {
    throw new Error(
      "REAL_DATA_ONLY: synthetic bars are forbidden for this validation run",
    );
  }
  if (
    input.datasetId.includes("synthetic") ||
    input.sources.some((s) => /synthetic|generated/i.test(s))
  ) {
    throw new Error(
      "REAL_DATA_ONLY: generated/synthetic data source detected — aborting",
    );
  }
}

export function emptyRealDataProvenance(overrides?: {
  realDataOnly?: boolean;
  syntheticDataUsed?: boolean;
}): Pick<
  import("@/lib/backtest/types").BacktestRunRecord,
  | "realDataOnly"
  | "syntheticDataUsed"
  | "label"
  | "sourceBySymbol"
  | "sourceByTimeframe"
  | "missingPeriods"
  | "excludedSymbols"
  | "coveragePercentage"
  | "dataQualityStatus"
> {
  const synthetic = overrides?.syntheticDataUsed ?? false;
  const realOnly = overrides?.realDataOnly ?? false;
  return {
    realDataOnly: realOnly,
    syntheticDataUsed: synthetic,
    label: synthetic
      ? "SYNTHETIC BACKTEST"
      : realOnly
        ? "REAL HISTORICAL BACKTEST"
        : "MIXED / INVALID",
    sourceBySymbol: {},
    sourceByTimeframe: {},
    missingPeriods: [],
    excludedSymbols: [],
    coveragePercentage: null,
    dataQualityStatus: "UNKNOWN",
  };
}

// Note: runFingerprint attached by engine after construction.
