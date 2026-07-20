/**
 * Centralized AutoTradeRuntimeSettingsService.
 * Env = startup defaults; persisted overrides apply without restart.
 * Paper only — never unlocks live trading or disables the risk engine.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildRuntimeSettingsFromEnv,
  SETTINGS_META,
} from "@/lib/auto-trade/runtime-settings/defaults";
import { validateRuntimeSettingsPatch } from "@/lib/auto-trade/runtime-settings/validate";
import type {
  AutoTradeRuntimeSettings,
  RuntimeSettingsPatch,
  SettingsAuditEntry,
} from "@/lib/auto-trade/runtime-settings/types";
import { DEFAULT_PAPER_SOAK_WATCHLIST } from "@/lib/universe/paper-soak-watchlist";
import {
  isDefaultishWatchlist,
  isLegacyMegaCapWatchlist,
  isV1DefaultWatchlist,
  V1_DEFAULT_WATCHLIST,
} from "@/lib/universe/v1-default-watchlist";
import { getTradingDataDir } from "@/lib/paths/data-root";

export function isMegaCapDefaultWatchlist(list: string[]): boolean {
  return isLegacyMegaCapWatchlist(list);
}

export type WatchlistSourceInfo = {
  source: "runtime" | "paper_soak" | "env_default" | "v1_default";
  effective: string[];
  paperSoakActive: boolean;
  note: string;
};

export function describeWatchlistSource(
  settings: AutoTradeRuntimeSettings,
): WatchlistSourceInfo {
  const paperSoakActive = settings.paperSoakProfile;
  if (paperSoakActive) {
    const effective = isDefaultishWatchlist(settings.watchlist)
      ? [...DEFAULT_PAPER_SOAK_WATCHLIST]
      : settings.watchlist;
    return {
      source: "paper_soak",
      effective,
      paperSoakActive: true,
      note: "Paper soak profile is ON — soak watchlist overrides Version 1 / mega-cap defaults. Edits persist as runtime values.",
    };
  }
  if (
    settings.watchlist.length === 0 ||
    isLegacyMegaCapWatchlist(settings.watchlist) ||
    isV1DefaultWatchlist(settings.watchlist)
  ) {
    const effective =
      settings.watchlist.length === 0 ||
      isLegacyMegaCapWatchlist(settings.watchlist)
        ? [...V1_DEFAULT_WATCHLIST]
        : settings.watchlist;
    return {
      source: "v1_default",
      effective,
      paperSoakActive: false,
      note: "Using Version 1 default watchlist (liquid mid-price U.S. stocks). Edit the list or enable Paper Soak Profile to change.",
    };
  }
  return {
    source: "runtime",
    effective: settings.watchlist,
    paperSoakActive: false,
    note: "Using persisted runtime watchlist.",
  };
}

function settingsPaths() {
  const DIR = getTradingDataDir();
  return {
    DIR,
    FILE: path.join(DIR, "auto-trade-settings.json"),
    AUDIT: path.join(DIR, "auto-trade-settings-audit.jsonl"),
  };
}

let cache: AutoTradeRuntimeSettings | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function newId(): string {
  return `set_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDir() {
  await mkdir(settingsPaths().DIR, { recursive: true });
}

function serializeValue(
  v: unknown,
): string | number | boolean | string[] | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  if (Array.isArray(v)) return v.map(String);
  return String(v);
}

async function appendAudit(entries: SettingsAuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await ensureDir();
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(settingsPaths().AUDIT, lines, { flag: "a" });
}

async function persist(settings: AutoTradeRuntimeSettings): Promise<void> {
  await ensureDir();
  await writeFile(
    settingsPaths().FILE,
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
  cache = settings;
}

function mergeLoaded(
  raw: Partial<AutoTradeRuntimeSettings>,
): AutoTradeRuntimeSettings {
  const defaults = buildRuntimeSettingsFromEnv();
  return {
    ...defaults,
    ...raw,
    paperOnly: true,
    liveTradingAllowed: false,
    riskEngineRequired: true,
    bracketsRequired: true,
    configVersion:
      typeof raw.configVersion === "number" && raw.configVersion >= 1
        ? raw.configVersion
        : defaults.configVersion,
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * Sync effective settings (cache or env defaults). Safe for hot paths.
 */
export function getEffectiveRuntimeSettings(): AutoTradeRuntimeSettings {
  return cache ?? buildRuntimeSettingsFromEnv();
}

/** Load from disk once; seed from env if missing. */
export async function loadRuntimeSettings(): Promise<AutoTradeRuntimeSettings> {
  if (cache) return cache;
  try {
    const raw = await readFile(settingsPaths().FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AutoTradeRuntimeSettings>;
    cache = mergeLoaded(parsed);
    return cache;
  } catch {
    const seeded = buildRuntimeSettingsFromEnv();
    await persist(seeded);
    return seeded;
  }
}

export async function getRuntimeSettings(): Promise<AutoTradeRuntimeSettings> {
  return loadRuntimeSettings();
}

export type PatchSettingsResult =
  | {
      ok: true;
      settings: AutoTradeRuntimeSettings;
      changedFields: string[];
    }
  | { ok: false; errors: string[] };

/**
 * Apply a validated patch. Serialized to avoid concurrent corruption.
 */
export async function patchRuntimeSettings(input: {
  patch: RuntimeSettingsPatch;
  actor?: string;
  reason?: string | null;
}): Promise<PatchSettingsResult> {
  const run = async (): Promise<PatchSettingsResult> => {
    const current = await loadRuntimeSettings();
    const validated = validateRuntimeSettingsPatch(current, input.patch);
    if (!validated.ok) return { ok: false, errors: validated.errors };

    const normalized = { ...validated.normalized };

    // Enabling soak profile: replace defaultish lists with soak candidates unless user sent a custom list.
    if (
      normalized.paperSoakProfile === true &&
      normalized.watchlist == null &&
      isDefaultishWatchlist(current.watchlist)
    ) {
      normalized.watchlist = [...DEFAULT_PAPER_SOAK_WATCHLIST];
    }
    if (
      normalized.paperSoakProfile === true &&
      normalized.watchlist != null &&
      isDefaultishWatchlist(normalized.watchlist)
    ) {
      normalized.watchlist = [...DEFAULT_PAPER_SOAK_WATCHLIST];
    }
    // Disabling soak: restore Version 1 default when the list was the soak default.
    if (
      normalized.paperSoakProfile === false &&
      current.paperSoakProfile === true &&
      normalized.watchlist == null
    ) {
      const soakSet = new Set(DEFAULT_PAPER_SOAK_WATCHLIST);
      const looksLikeSoak =
        current.watchlist.length >= 20 &&
        current.watchlist.every((s) => soakSet.has(s.toUpperCase()));
      if (looksLikeSoak || isDefaultishWatchlist(current.watchlist)) {
        normalized.watchlist = [...V1_DEFAULT_WATCHLIST];
      }
    }

    const next: AutoTradeRuntimeSettings = {
      ...current,
      ...normalized,
      paperOnly: true,
      liveTradingAllowed: false,
      riskEngineRequired: true,
      bracketsRequired: true,
      configVersion: current.configVersion + 1,
      updatedAt: new Date().toISOString(),
    };

    const changedFields: string[] = [];
    const audits: SettingsAuditEntry[] = [];
    for (const key of Object.keys(normalized) as (keyof RuntimeSettingsPatch)[]) {
      const prev = current[key as keyof AutoTradeRuntimeSettings];
      const neu = next[key as keyof AutoTradeRuntimeSettings];
      if (JSON.stringify(prev) === JSON.stringify(neu)) continue;
      changedFields.push(String(key));
      audits.push({
        id: newId(),
        time: next.updatedAt,
        actor: input.actor ?? "ui",
        reason: input.reason ?? null,
        field: String(key),
        previousValue: serializeValue(prev),
        newValue: serializeValue(neu),
        configVersion: next.configVersion,
        paperOnly: true,
      });
    }

    if (changedFields.length === 0) {
      return { ok: true, settings: current, changedFields: [] };
    }

    await persist(next);
    await appendAudit(audits);
    return { ok: true, settings: next, changedFields };
  };

  const result = writeChain.then(run, run);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function resetRuntimeSettings(input?: {
  actor?: string;
  reason?: string | null;
}): Promise<AutoTradeRuntimeSettings> {
  const run = async () => {
    const current = await loadRuntimeSettings();
    const defaults = buildRuntimeSettingsFromEnv();
    const next: AutoTradeRuntimeSettings = {
      ...defaults,
      configVersion: current.configVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    await persist(next);
    await appendAudit([
      {
        id: newId(),
        time: next.updatedAt,
        actor: input?.actor ?? "ui",
        reason: input?.reason ?? "restore_safe_defaults",
        field: "*",
        previousValue: current.configVersion,
        newValue: next.configVersion,
        configVersion: next.configVersion,
        paperOnly: true,
      },
    ]);
    return next;
  };
  const result = writeChain.then(run, run);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function setExecutionEnabled(
  enabled: boolean,
  actor = "ui",
): Promise<PatchSettingsResult> {
  return patchRuntimeSettings({
    patch: { executionEnabled: enabled },
    actor,
    reason: enabled ? "execution_enable" : "execution_disable",
  });
}

export async function setAutoTradingEnabled(
  enabled: boolean,
  actor = "ui",
): Promise<PatchSettingsResult> {
  return patchRuntimeSettings({
    patch: { autoTradingEnabled: enabled },
    actor,
    reason: enabled ? "auto_trading_enable" : "auto_trading_disable",
  });
}

export async function readSettingsAudit(
  limit = 50,
): Promise<SettingsAuditEntry[]> {
  try {
    const raw = await readFile(settingsPaths().AUDIT, "utf8");
    const rows: SettingsAuditEntry[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t) as SettingsAuditEntry);
      } catch {
        // skip
      }
    }
    return rows.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export function getSettingsMeta() {
  return SETTINGS_META;
}

/** Test helper */
export async function resetRuntimeSettingsCacheForTests(): Promise<void> {
  cache = null;
}
