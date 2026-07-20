/**
 * Controlled typed challenger experiments (Milestone I-4).
 * Max 3 additional beyond v1.1 regime filter. Acceptance rules locked at creation.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerStrategyVersion } from "@/lib/strategy/registry";
import { getChampionIdentity } from "@/lib/strategy/registry";

const DIR = path.join(process.cwd(), "data", "experiments");
const FILE = path.join(DIR, "experiments.json");

export type ExperimentKind =
  | "cost_aware_filter"
  | "confidence_threshold"
  | "time_of_day_filter";

export type AcceptanceRules = {
  hypothesis: string;
  changedParameters: Record<string, number | string | boolean>;
  expectedBenefit: string;
  mainRisk: string;
  minimumTradeCount: number;
  minimumOosExpectancy: number;
  minimumProfitFactor: number;
  maximumDrawdown: number;
  maximumPerformanceDecay: number;
  costStressRequirement: string;
  regimeCoverageRequirement: string;
  shadowEvidenceRequirement: string;
  lockedAt: string;
  rulesHash: string;
};

export type ExperimentRecord = {
  id: string;
  kind: ExperimentKind;
  name: string;
  version: string;
  parentVersion: string;
  status: "DRAFT" | "BACKTESTING" | "SHADOW" | "REJECTED" | "COMPLETE";
  acceptance: AcceptanceRules;
  createdAt: string;
  resultsSummary: string | null;
  paperOnly: true;
  brokerSubmit: false;
};

function hashRules(rules: Omit<AcceptanceRules, "lockedAt" | "rulesHash">): string {
  return createHash("sha256")
    .update(JSON.stringify(rules))
    .digest("hex")
    .slice(0, 16);
}

async function loadAll(): Promise<ExperimentRecord[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    return JSON.parse(raw) as ExperimentRecord[];
  } catch {
    return [];
  }
}

async function saveAll(rows: ExperimentRecord[]) {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

export function assertAcceptanceImmutable(
  original: AcceptanceRules,
  next: AcceptanceRules,
): void {
  if (original.rulesHash !== next.rulesHash) {
    throw new Error(
      "Acceptance criteria cannot be silently changed after experiment creation",
    );
  }
  const { lockedAt: _la, rulesHash: _rh, ...restOrig } = original;
  void _la;
  void _rh;
  const { lockedAt: _lb, rulesHash: _rb, ...restNext } = next;
  void _lb;
  void _rb;
  if (JSON.stringify(restOrig) !== JSON.stringify(restNext)) {
    throw new Error(
      "Acceptance criteria body changed after lock — forbidden",
    );
  }
}

const TEMPLATES: Record<
  ExperimentKind,
  {
    name: string;
    versionSuffix: string;
    params: Record<string, number | string | boolean>;
    hypothesis: string;
    expectedBenefit: string;
    mainRisk: string;
  }
> = {
  cost_aware_filter: {
    name: "Paper Intelligence Cost-Aware Filter",
    versionSuffix: "v1.2.0-cost-aware",
    params: {
      maxCostToRewardPct: 0.35,
      scoringUnchanged: true,
    },
    hypothesis:
      "Rejecting entries where estimated spread+slippage exceeds 35% of expected reward improves after-cost expectancy.",
    expectedBenefit: "Higher PF after costs; fewer fragile trades",
    mainRisk: "Fewer trades; may miss good setups in wider markets",
  },
  confidence_threshold: {
    name: "Paper Intelligence Higher Confidence",
    versionSuffix: "v1.2.1-confidence",
    params: {
      minConfidence: 0.65,
      scoringUnchanged: true,
    },
    hypothesis:
      "Raising min confidence to 0.65 where historical evidence supports it improves expectancy.",
    expectedBenefit: "Fewer low-quality entries",
    mainRisk: "Trade count drop below evidence thresholds",
  },
  time_of_day_filter: {
    name: "Paper Intelligence Time-of-Day Filter",
    versionSuffix: "v1.2.2-tod-filter",
    params: {
      blockedHoursEt: "09,15",
      scoringUnchanged: true,
    },
    hypothesis:
      "Blocking hours with negative real expectancy and adequate sample improves session quality.",
    expectedBenefit: "Remove documented weak time windows",
    mainRisk: "Miss valid late-morning setups; regime interaction",
  },
};

export async function createTypedExperiment(
  kind: ExperimentKind,
): Promise<
  | { ok: true; experiment: ExperimentRecord }
  | { ok: false; error: string }
> {
  const all = await loadAll();
  const extras = all.filter((e) => e.kind !== "cost_aware_filter" || true);
  // Max 3 additional typed experiments total in registry file
  if (all.length >= 3) {
    return {
      ok: false,
      error: "Maximum of three additional typed challengers already created",
    };
  }
  if (all.some((e) => e.kind === kind)) {
    const existing = all.find((e) => e.kind === kind)!;
    return { ok: true, experiment: existing };
  }

  const tpl = TEMPLATES[kind];
  const champ = getChampionIdentity();
  const baseRules = {
    hypothesis: tpl.hypothesis,
    changedParameters: tpl.params,
    expectedBenefit: tpl.expectedBenefit,
    mainRisk: tpl.mainRisk,
    minimumTradeCount: 80,
    minimumOosExpectancy: 0,
    minimumProfitFactor: 1.1,
    maximumDrawdown: 0.15,
    maximumPerformanceDecay: 0.5,
    costStressRequirement: "Remain non-negative under moderate 8/5 bps stress",
    regimeCoverageRequirement: "Preserve ≥2 meaningful regimes",
    shadowEvidenceRequirement: "≥5 valid shadow sessions before promotion review",
  };
  const lockedAt = new Date().toISOString();
  const acceptance: AcceptanceRules = {
    ...baseRules,
    lockedAt,
    rulesHash: hashRules(baseRules),
  };

  const reg = await registerStrategyVersion({
    strategyId: champ.strategyId,
    name: tpl.name,
    version: tpl.versionSuffix,
    status: "DRAFT",
    parentVersion: champ.version,
    entryRules: `Typed challenger (${kind}): ${tpl.hypothesis}. Scoring unchanged.`,
    exitRules: "Inherited brackets from champion.",
    featureSet: ["typed_params", "shared_evaluator", "no_broker_submit"],
    parameterValues: tpl.params,
    supportedRegimes: [
      "trending_up",
      "trending_down",
      "range_bound",
      "high_volume_momentum",
    ],
    supportedUniverse: "same as parent",
    riskRequirements: ["paper_only", "no_broker_in_backtest", "no_broker_in_shadow"],
    backtestPeriod: { start: null, end: null },
    validationResults: null,
    paperTradingResults: null,
    rejectionReason: null,
    rollbackTarget: champ.version,
  });
  if (!reg.ok) {
    // version may already exist
    if (!reg.error.includes("immutable")) return reg;
  }

  const experiment: ExperimentRecord = {
    id: `exp_${kind}`,
    kind,
    name: tpl.name,
    version: tpl.versionSuffix,
    parentVersion: champ.version,
    status: "DRAFT",
    acceptance,
    createdAt: lockedAt,
    resultsSummary: null,
    paperOnly: true,
    brokerSubmit: false,
  };
  all.push(experiment);
  await saveAll(all);
  void extras;
  return { ok: true, experiment };
}

export async function listExperiments(): Promise<ExperimentRecord[]> {
  return loadAll();
}

export async function getExperiment(
  id: string,
): Promise<ExperimentRecord | null> {
  const all = await loadAll();
  return all.find((e) => e.id === id) ?? null;
}
