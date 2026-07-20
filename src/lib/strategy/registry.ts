/**
 * Strategy registry — immutable version definitions.
 * Champion Paper Intelligence v1 cannot be overwritten.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStrategyConfig } from "@/lib/strategy/version";

export type StrategyStatus =
  | "DRAFT"
  | "BACKTESTING"
  | "REJECTED"
  | "SHADOW"
  | "PAPER_CANDIDATE"
  | "CHAMPION"
  | "RETIRED";

export type StrategyRegistryEntry = {
  strategyId: string;
  name: string;
  version: string;
  status: StrategyStatus;
  createdAt: string;
  parentVersion: string | null;
  entryRules: string;
  exitRules: string;
  featureSet: string[];
  parameterValues: Record<string, number | string | boolean>;
  supportedRegimes: string[];
  supportedUniverse: string;
  riskRequirements: string[];
  backtestPeriod: { start: string | null; end: string | null };
  validationResults: Record<string, unknown> | null;
  paperTradingResults: Record<string, unknown> | null;
  promotionHistory: { at: string; action: string; note: string }[];
  rejectionReason: string | null;
  rollbackTarget: string | null;
  paperOnly: true;
  liveTradingAllowed: false;
};

export type StrategyRegistryFile = {
  updatedAt: string;
  entries: StrategyRegistryEntry[];
};

const DIR = path.join(process.cwd(), "data", "strategy");
const FILE = path.join(DIR, "registry.json");
const AUDIT = path.join(DIR, "registry-audit.jsonl");

const CHAMPION_ID = "paper-intelligence";
const CHAMPION_VERSION = "v1.0.0";

function championSeed(): StrategyRegistryEntry {
  const cfg = getStrategyConfig();
  return {
    strategyId: CHAMPION_ID,
    name: cfg.name || "Paper Intelligence v1",
    version: CHAMPION_VERSION,
    status: "CHAMPION",
    createdAt: "2026-01-01T00:00:00.000Z",
    parentVersion: null,
    entryRules:
      "Heuristic multi-score BUY/SELL via decideForSymbol; confidence and eligibility gates; risk engine required.",
    exitRules:
      "Bracket stop-loss and take-profit; risk daily limits; emergency stop preserves positions.",
    featureSet: [
      "technicalLean",
      "vwap",
      "volumeRatio",
      "spread",
      "marketCondition",
      "newsScore",
      "atr",
      "rsi",
      "macd",
    ],
    parameterValues: { ...cfg.weights },
    supportedRegimes: [
      "trending_up",
      "trending_down",
      "range_bound",
      "high_volatility",
      "low_volatility",
      "high_volume_momentum",
      "weak_uncertain",
    ],
    supportedUniverse: "runtime watchlist / paper-soak mid-price filter",
    riskRequirements: [
      "risk_engine_required",
      "brackets_required",
      "paper_only",
      "live_trading_blocked",
    ],
    backtestPeriod: { start: null, end: null },
    validationResults: null,
    paperTradingResults: null,
    promotionHistory: [
      {
        at: "2026-01-01T00:00:00.000Z",
        action: "seed_champion",
        note: "Initial champion — Paper Intelligence v1",
      },
    ],
    rejectionReason: null,
    rollbackTarget: null,
    paperOnly: true,
    liveTradingAllowed: false,
  };
}

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

async function appendAudit(entry: Record<string, unknown>) {
  await ensureDir();
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n";
  await writeFile(AUDIT, line, { flag: "a" });
}

export async function loadStrategyRegistry(): Promise<StrategyRegistryFile> {
  return readStrategyRegistry();
}

/**
 * Read-only registry access — never creates files, never seeds to disk.
 * Missing/corrupt file → in-memory champion only (no write).
 */
export async function readStrategyRegistry(): Promise<StrategyRegistryFile> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as StrategyRegistryFile;
    if (parsed?.entries?.length) {
      const hasChampion = parsed.entries.some(
        (e) =>
          e.strategyId === CHAMPION_ID &&
          e.version === CHAMPION_VERSION &&
          e.status === "CHAMPION",
      );
      if (!hasChampion) {
        return {
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
          entries: [championSeed(), ...parsed.entries],
        };
      }
      return parsed;
    }
  } catch {
    // missing or unreadable — do not write
  }
  return {
    updatedAt: new Date().toISOString(),
    entries: [championSeed()],
  };
}

/**
 * Ensure registry file exists for mutation paths only (not used by GET handlers).
 */
export async function ensureStrategyRegistryPersisted(): Promise<StrategyRegistryFile> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as StrategyRegistryFile;
    if (parsed?.entries?.length) {
      const hasChampion = parsed.entries.some(
        (e) =>
          e.strategyId === CHAMPION_ID &&
          e.version === CHAMPION_VERSION &&
          e.status === "CHAMPION",
      );
      if (!hasChampion) {
        parsed.entries.unshift(championSeed());
        await persist(parsed);
      }
      return parsed;
    }
  } catch {
    // seed to disk for mutations
  }
  const seeded: StrategyRegistryFile = {
    updatedAt: new Date().toISOString(),
    entries: [championSeed()],
  };
  await persist(seeded);
  return seeded;
}

async function persist(file: StrategyRegistryFile): Promise<void> {
  await ensureDir();
  file.updatedAt = new Date().toISOString();
  await writeFile(FILE, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export async function getChampionStrategy(): Promise<StrategyRegistryEntry> {
  const reg = await readStrategyRegistry();
  const champ = reg.entries.find((e) => e.status === "CHAMPION");
  if (champ) return champ;
  return championSeed();
}

export function getChampionIdentity(): {
  strategyId: string;
  version: string;
  name: string;
} {
  const cfg = getStrategyConfig();
  return {
    strategyId: CHAMPION_ID,
    version: CHAMPION_VERSION,
    name: cfg.name,
  };
}

/**
 * Register a new strategy version. Never overwrites an existing (id, version).
 */
export async function registerStrategyVersion(
  entry: Omit<
    StrategyRegistryEntry,
    "paperOnly" | "liveTradingAllowed" | "createdAt" | "promotionHistory"
  > & {
    createdAt?: string;
    promotionHistory?: StrategyRegistryEntry["promotionHistory"];
  },
): Promise<{ ok: true; entry: StrategyRegistryEntry } | { ok: false; error: string }> {
  const reg = await ensureStrategyRegistryPersisted();
  const exists = reg.entries.find(
    (e) => e.strategyId === entry.strategyId && e.version === entry.version,
  );
  if (exists) {
    return {
      ok: false,
      error:
        "Strategy version is immutable. Create a new version instead of overwriting.",
    };
  }
  if (
    entry.strategyId === CHAMPION_ID &&
    entry.version === CHAMPION_VERSION &&
    entry.status !== "CHAMPION"
  ) {
    return {
      ok: false,
      error: "Cannot re-register champion identity with a non-CHAMPION status.",
    };
  }

  const next: StrategyRegistryEntry = {
    ...entry,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    promotionHistory: entry.promotionHistory ?? [],
    paperOnly: true,
    liveTradingAllowed: false,
  };
  reg.entries.push(next);
  await persist(reg);
  await appendAudit({
    action: "register",
    strategyId: next.strategyId,
    version: next.version,
    status: next.status,
  });
  return { ok: true, entry: next };
}

/**
 * Status-only updates (e.g. DRAFT → BACKTESTING). Cannot mutate rules/params.
 * Cannot demote/overwrite champion rules; demoting CHAMPION requires explicit retire + new champion (later milestones).
 */
export async function updateStrategyStatus(input: {
  strategyId: string;
  version: string;
  status: StrategyStatus;
  rejectionReason?: string | null;
  actor?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const reg = await ensureStrategyRegistryPersisted();
  const idx = reg.entries.findIndex(
    (e) => e.strategyId === input.strategyId && e.version === input.version,
  );
  if (idx < 0) return { ok: false, error: "Strategy version not found" };

  const current = reg.entries[idx]!;
  if (
    current.strategyId === CHAMPION_ID &&
    current.version === CHAMPION_VERSION &&
    current.status === "CHAMPION" &&
    input.status !== "CHAMPION"
  ) {
    return {
      ok: false,
      error:
        "Champion cannot be overwritten or demoted in Milestone I-1. Use promotion flow in later milestones.",
    };
  }

  reg.entries[idx] = {
    ...current,
    status: input.status,
    rejectionReason:
      input.rejectionReason !== undefined
        ? input.rejectionReason
        : current.rejectionReason,
    // rules/params unchanged
    entryRules: current.entryRules,
    exitRules: current.exitRules,
    featureSet: [...current.featureSet],
    parameterValues: { ...current.parameterValues },
  };
  await persist(reg);
  await appendAudit({
    action: "status_update",
    strategyId: input.strategyId,
    version: input.version,
    from: current.status,
    to: input.status,
    actor: input.actor ?? "system",
  });
  return { ok: true };
}

/** Reject attempts to patch immutable fields on an existing version. */
export async function assertStrategyImmutable(
  strategyId: string,
  version: string,
  attemptedPatch: Partial<StrategyRegistryEntry>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const reg = await readStrategyRegistry();
  const existing = reg.entries.find(
    (e) => e.strategyId === strategyId && e.version === version,
  );
  if (!existing) return { ok: true };
  const forbidden = [
    "entryRules",
    "exitRules",
    "featureSet",
    "parameterValues",
    "name",
  ] as const;
  for (const key of forbidden) {
    if (
      attemptedPatch[key] !== undefined &&
      JSON.stringify(attemptedPatch[key]) !== JSON.stringify(existing[key])
    ) {
      return {
        ok: false,
        error: `Cannot mutate ${key} on existing strategy version. Register a new version.`,
      };
    }
  }
  if (
    strategyId === CHAMPION_ID &&
    version === CHAMPION_VERSION &&
    attemptedPatch.parameterValues &&
    JSON.stringify(attemptedPatch.parameterValues) !==
      JSON.stringify(existing.parameterValues)
  ) {
    return { ok: false, error: "Champion parameters cannot be overwritten." };
  }
  return { ok: true };
}
