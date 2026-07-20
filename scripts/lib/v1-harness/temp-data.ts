/**
 * Temporary data-root isolation for Version 1 deterministic tests.
 * Sets TRADINGAI_DATA_DIR so lifecycle/daily stores never touch production data/.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type TempDataHandle = {
  dir: string;
  previous: string | undefined;
  cleanup: (opts?: { keepOnFailure?: boolean; failed?: boolean }) => Promise<void>;
};

export async function withTempTradingData(): Promise<TempDataHandle> {
  const dir = await mkdtemp(path.join(tmpdir(), "tradingai-v1-"));
  const previous = process.env.TRADINGAI_DATA_DIR;
  process.env.TRADINGAI_DATA_DIR = dir;
  return {
    dir,
    previous,
    cleanup: async ({ keepOnFailure = true, failed = false } = {}) => {
      if (previous === undefined) delete process.env.TRADINGAI_DATA_DIR;
      else process.env.TRADINGAI_DATA_DIR = previous;
      if (failed && keepOnFailure) {
        console.warn(`Keeping failed test data at ${dir}`);
        return;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}
