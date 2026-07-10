/**
 * Ranked trade candidates from the last scan.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "candidates.json");

export type RankedCandidate = {
  rank: number;
  symbol: string;
  currentPrice: number | null;
  volume: number | null;
  relativeVolume: number | null;
  bidAskSpread: number | null;
  trendState: string;
  momentumState: string;
  volatility: string;
  confidenceScore: number;
  proposedEntry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  qualificationReason: string | null;
  rejectionReason: string | null;
  qualified: boolean;
  paperOnly: true;
};

export type CandidatesSnapshot = {
  scannedAt: string;
  symbolsScanned: number;
  qualifiedCount: number;
  candidates: RankedCandidate[];
  paperOnly: true;
};

export async function saveCandidatesSnapshot(
  snapshot: CandidatesSnapshot,
): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function readCandidatesSnapshot(): Promise<CandidatesSnapshot | null> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as CandidatesSnapshot;
    if (parsed?.paperOnly !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}
