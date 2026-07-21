/**
 * Stable backtest run fingerprints for comparable reporting (Milestone I-4).
 */

import { createHash } from "node:crypto";
import type { ExecutionAssumptions } from "@/lib/backtest/types";

export const BACKTEST_ENGINE_VERSION = "i4.1.0";

export type RunFingerprintInput = {
  strategyVersion: string;
  datasetId: string;
  startDate: string;
  endDate: string;
  symbols: string[];
  timeframe: string;
  spreadModel: string;
  spreadValue: number;
  slippageModel: string;
  slippageValue: number;
  riskProfile: string;
  executionAssumptions: {
    sameCandleStopFirst: boolean;
    feeBps: number;
    startingEquity: number;
    atrSpreadMult: number;
  };
  engineVersion: string;
  evalStep?: number;
  blockedRegimes?: string[];
  minConfidence?: number;
  realDataOnly?: boolean;
};

export type RunFingerprint = RunFingerprintInput & {
  hash: string;
};

export function buildRunFingerprint(
  input: Omit<RunFingerprintInput, "engineVersion"> & {
    engineVersion?: string;
  },
): RunFingerprint {
  const normalized: RunFingerprintInput = {
    strategyVersion: input.strategyVersion,
    datasetId: input.datasetId,
    startDate: input.startDate.slice(0, 10),
    endDate: input.endDate.slice(0, 10),
    symbols: [...input.symbols].map((s) => s.toUpperCase()).sort(),
    timeframe: input.timeframe,
    spreadModel: input.spreadModel,
    spreadValue: input.spreadValue,
    slippageModel: input.slippageModel,
    slippageValue: input.slippageValue,
    riskProfile: input.riskProfile,
    executionAssumptions: {
      sameCandleStopFirst: input.executionAssumptions.sameCandleStopFirst,
      feeBps: input.executionAssumptions.feeBps,
      startingEquity: input.executionAssumptions.startingEquity,
      atrSpreadMult: input.executionAssumptions.atrSpreadMult,
    },
    engineVersion: input.engineVersion ?? BACKTEST_ENGINE_VERSION,
    evalStep: input.evalStep ?? null as unknown as number | undefined,
    blockedRegimes: [...(input.blockedRegimes ?? [])].sort(),
    minConfidence: input.minConfidence ?? 0.55,
    realDataOnly: input.realDataOnly ?? false,
  };

  const payload = JSON.stringify({
    strategyVersion: normalized.strategyVersion,
    datasetId: normalized.datasetId,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    symbols: normalized.symbols,
    timeframe: normalized.timeframe,
    spreadModel: normalized.spreadModel,
    spreadValue: normalized.spreadValue,
    slippageModel: normalized.slippageModel,
    slippageValue: normalized.slippageValue,
    riskProfile: normalized.riskProfile,
    executionAssumptions: normalized.executionAssumptions,
    engineVersion: normalized.engineVersion,
    evalStep: normalized.evalStep ?? null,
    blockedRegimes: normalized.blockedRegimes ?? [],
    minConfidence: normalized.minConfidence,
    realDataOnly: normalized.realDataOnly,
  });

  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 24);
  return { ...normalized, hash };
}

export function fingerprintFromAssumptions(input: {
  strategyVersion: string;
  datasetId: string;
  startDate: string;
  endDate: string;
  symbols: string[];
  timeframe: string;
  assumptions: ExecutionAssumptions;
  riskProfile?: string;
  evalStep?: number;
  blockedRegimes?: string[];
  minConfidence?: number;
  realDataOnly?: boolean;
}): RunFingerprint {
  return buildRunFingerprint({
    strategyVersion: input.strategyVersion,
    datasetId: input.datasetId,
    startDate: input.startDate,
    endDate: input.endDate,
    symbols: input.symbols,
    timeframe: input.timeframe,
    spreadModel: input.assumptions.spreadModel,
    spreadValue: input.assumptions.fixedSpreadBps,
    slippageModel: input.assumptions.slippageModel,
    slippageValue: input.assumptions.fixedSlippageBps,
    riskProfile: input.riskProfile ?? "runtime_risk_config",
    executionAssumptions: {
      sameCandleStopFirst: input.assumptions.sameCandleStopFirst,
      feeBps: input.assumptions.feeBps,
      startingEquity: input.assumptions.startingEquity,
      atrSpreadMult: input.assumptions.atrSpreadMult,
    },
    evalStep: input.evalStep,
    blockedRegimes: input.blockedRegimes,
    minConfidence: input.minConfidence,
    realDataOnly: input.realDataOnly,
  });
}

export type FingerprintCompare = {
  comparable: boolean;
  sameHash: boolean;
  differences: string[];
};

export function compareFingerprints(
  a: RunFingerprint | null | undefined,
  b: RunFingerprint | null | undefined,
): FingerprintCompare {
  if (!a || !b) {
    return {
      comparable: false,
      sameHash: false,
      differences: ["missing fingerprint"],
    };
  }
  if (a.hash === b.hash) {
    return { comparable: true, sameHash: true, differences: [] };
  }
  const diffs: string[] = [];
  const keys: (keyof RunFingerprintInput)[] = [
    "strategyVersion",
    "datasetId",
    "startDate",
    "endDate",
    "timeframe",
    "spreadModel",
    "spreadValue",
    "slippageModel",
    "slippageValue",
    "riskProfile",
    "engineVersion",
    "evalStep",
    "minConfidence",
    "realDataOnly",
  ];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      diffs.push(`${k}: ${JSON.stringify(a[k])} ≠ ${JSON.stringify(b[k])}`);
    }
  }
  if (JSON.stringify(a.symbols) !== JSON.stringify(b.symbols)) {
    diffs.push("symbols differ");
  }
  if (
    JSON.stringify(a.blockedRegimes) !== JSON.stringify(b.blockedRegimes)
  ) {
    diffs.push("blockedRegimes differ");
  }
  if (
    JSON.stringify(a.executionAssumptions) !==
    JSON.stringify(b.executionAssumptions)
  ) {
    diffs.push("executionAssumptions differ");
  }
  return { comparable: false, sameHash: false, differences: diffs };
}
