/**
 * Persist Version 1 daily sessions under data/v1-daily-sessions/.
 * Atomic temp+rename writes. Prior dates are never overwritten by a new day.
 */

import { mkdir, readFile, rename, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getTradingDataDir } from "@/lib/paths/data-root";
import type { V1DailySession } from "@/lib/trading/v1-daily/types";

function sessionDir(): string {
  return path.join(getTradingDataDir(), "v1-daily-sessions");
}

function latestPath(): string {
  return path.join(getTradingDataDir(), "v1-daily-latest.json");
}

function sessionPath(tradingDate: string): string {
  return path.join(sessionDir(), `${tradingDate}.json`);
}

async function ensureDir() {
  await mkdir(sessionDir(), { recursive: true });
}

async function atomicWrite(file: string, body: string): Promise<void> {
  await ensureDir();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, file);
}

export async function readV1DailySession(
  tradingDate: string,
): Promise<V1DailySession | null> {
  try {
    const raw = await readFile(sessionPath(tradingDate), "utf8");
    const parsed = JSON.parse(raw) as V1DailySession;
    if (parsed?.paperOnly !== true || parsed.tradingDate !== tradingDate) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeV1DailySession(
  session: V1DailySession,
): Promise<V1DailySession> {
  const next: V1DailySession = {
    ...session,
    paperOnly: true,
    updatedAt: new Date().toISOString(),
  };
  const body = `${JSON.stringify(next, null, 2)}\n`;
  await atomicWrite(sessionPath(next.tradingDate), body);
  await atomicWrite(latestPath(), body);
  return next;
}

export async function listV1DailySessionDates(): Promise<string[]> {
  try {
    await ensureDir();
    const files = await readdir(sessionDir());
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export async function readV1DailyLatest(): Promise<V1DailySession | null> {
  try {
    const raw = await readFile(latestPath(), "utf8");
    const parsed = JSON.parse(raw) as V1DailySession;
    if (parsed?.paperOnly !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}
