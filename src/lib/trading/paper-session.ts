/**
 * Paper-trading session lifecycle for soak testing.
 * Tracks engine start/stop; does not place orders.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marketDayKey } from "@/lib/market/time";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "paper-session.json");

export type PaperSessionMeta = {
  paperOnly: true;
  sessionDate: string;
  engineStartedAt: string | null;
  engineStoppedAt: string | null;
  status: "idle" | "running" | "stopped";
  peakEquity: number | null;
  maxDrawdownPct: number;
};

function defaultMeta(day = marketDayKey()): PaperSessionMeta {
  return {
    paperOnly: true,
    sessionDate: day,
    engineStartedAt: null,
    engineStoppedAt: null,
    status: "idle",
    peakEquity: null,
    maxDrawdownPct: 0,
  };
}

export async function readPaperSessionMeta(): Promise<PaperSessionMeta> {
  const today = marketDayKey();
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as PaperSessionMeta;
    if (parsed?.paperOnly !== true) return defaultMeta(today);
    if (parsed.sessionDate !== today) {
      return defaultMeta(today);
    }
    return parsed;
  } catch {
    return defaultMeta(today);
  }
}

async function writeMeta(meta: PaperSessionMeta): Promise<PaperSessionMeta> {
  await mkdir(DIR, { recursive: true });
  const next = { ...meta, paperOnly: true as const };
  await writeFile(FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** Mark soak/auto engine as started for today's session. */
export async function markPaperSessionStarted(): Promise<PaperSessionMeta> {
  const current = await readPaperSessionMeta();
  if (current.status === "running" && current.engineStartedAt) {
    return current;
  }
  return writeMeta({
    ...current,
    engineStartedAt: current.engineStartedAt ?? new Date().toISOString(),
    engineStoppedAt: null,
    status: "running",
  });
}

/** Mark engine stopped (pause / kill / end of day). */
export async function markPaperSessionStopped(): Promise<PaperSessionMeta> {
  const current = await readPaperSessionMeta();
  return writeMeta({
    ...current,
    engineStoppedAt: new Date().toISOString(),
    status: "stopped",
  });
}

/** Update peak equity / drawdown for the session. */
export async function updateSessionEquityPeak(
  equity: number,
): Promise<PaperSessionMeta> {
  if (!(equity > 0)) return readPaperSessionMeta();
  const current = await readPaperSessionMeta();
  const peak =
    current.peakEquity != null && current.peakEquity > equity
      ? current.peakEquity
      : equity;
  const drawdownPct =
    peak > 0 ? Number((((peak - equity) / peak) * 100).toFixed(4)) : 0;
  return writeMeta({
    ...current,
    peakEquity: peak,
    maxDrawdownPct: Math.max(current.maxDrawdownPct, drawdownPct),
  });
}
