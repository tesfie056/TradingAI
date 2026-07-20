/**
 * Persist Version 1 lifecycle trades under data/.
 * Uses write-temp-then-rename for atomic updates of the active store.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getTradingDataDir } from "@/lib/paths/data-root";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";

function dataPaths() {
  const DIR = getTradingDataDir();
  return {
    DIR,
    ACTIVE_FILE: path.join(DIR, "v1-lifecycle-trades.json"),
    HISTORY_FILE: path.join(DIR, "v1-lifecycle-history.jsonl"),
  };
}

export type V1LifecycleStore = {
  paperOnly: true;
  updatedAt: string;
  trades: V1LifecycleTrade[];
};

const emptyStore = (): V1LifecycleStore => ({
  paperOnly: true,
  updatedAt: new Date().toISOString(),
  trades: [],
});

async function ensureDir() {
  await mkdir(dataPaths().DIR, { recursive: true });
}

async function atomicWriteJson(file: string, body: string): Promise<void> {
  await ensureDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, file);
}

export async function readV1LifecycleStore(): Promise<V1LifecycleStore> {
  try {
    const raw = await readFile(dataPaths().ACTIVE_FILE, "utf8");
    const parsed = JSON.parse(raw) as V1LifecycleStore;
    if (parsed?.paperOnly !== true || !Array.isArray(parsed.trades)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeV1LifecycleStore(
  store: V1LifecycleStore,
): Promise<V1LifecycleStore> {
  const next: V1LifecycleStore = {
    paperOnly: true,
    updatedAt: new Date().toISOString(),
    trades: store.trades,
  };
  await atomicWriteJson(
    dataPaths().ACTIVE_FILE,
    `${JSON.stringify(next, null, 2)}\n`,
  );
  return next;
}

export async function upsertV1LifecycleTrade(
  trade: V1LifecycleTrade,
): Promise<V1LifecycleTrade> {
  const store = await readV1LifecycleStore();
  const idx = store.trades.findIndex((t) => t.tradeId === trade.tradeId);
  if (idx >= 0) store.trades[idx] = trade;
  else store.trades.push(trade);
  await writeV1LifecycleStore(store);
  if (trade.lifecycleState === "COMPLETED") {
    await appendV1LifecycleHistory(trade);
  }
  return trade;
}

export async function getV1LifecycleTrade(
  tradeId: string,
): Promise<V1LifecycleTrade | null> {
  const store = await readV1LifecycleStore();
  return store.trades.find((t) => t.tradeId === tradeId) ?? null;
}

export async function findV1TradeByClientOrderId(
  clientOrderId: string,
): Promise<V1LifecycleTrade | null> {
  const store = await readV1LifecycleStore();
  return (
    store.trades.find(
      (t) =>
        t.clientOrderId === clientOrderId ||
        t.exitOrderIds.some((id) => id === clientOrderId),
    ) ?? null
  );
}

export async function findOpenV1TradeBySymbol(
  symbol: string,
): Promise<V1LifecycleTrade | null> {
  const store = await readV1LifecycleStore();
  const sym = symbol.toUpperCase();
  return (
    store.trades.find(
      (t) =>
        t.symbol === sym &&
        t.lifecycleState !== "COMPLETED" &&
        t.lifecycleState !== "ENTRY_REJECTED" &&
        t.lifecycleState !== "ENTRY_CANCELED",
    ) ?? null
  );
}

export async function listActiveV1Trades(): Promise<V1LifecycleTrade[]> {
  const store = await readV1LifecycleStore();
  return store.trades.filter(
    (t) =>
      t.lifecycleState !== "COMPLETED" &&
      t.lifecycleState !== "ENTRY_REJECTED",
  );
}

export async function listCompletedV1Trades(): Promise<V1LifecycleTrade[]> {
  const store = await readV1LifecycleStore();
  return store.trades.filter((t) => t.lifecycleState === "COMPLETED");
}

async function appendV1LifecycleHistory(trade: V1LifecycleTrade): Promise<void> {
  await ensureDir();
  await writeFile(
    dataPaths().HISTORY_FILE,
    `${JSON.stringify(trade)}\n`,
    { flag: "a" },
  );
}

/** Test helper — replace entire store (never call against live broker). */
export async function replaceV1LifecycleStoreForTests(
  trades: V1LifecycleTrade[],
): Promise<void> {
  await writeV1LifecycleStore({
    paperOnly: true,
    updatedAt: new Date().toISOString(),
    trades,
  });
}
