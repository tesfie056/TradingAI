/**
 * Resolvable data directory for persisted runtime state.
 * Production: `<cwd>/data`
 * Deterministic tests: set TRADINGAI_DATA_DIR to a temporary directory.
 */

import path from "node:path";

export function getTradingDataDir(): string {
  const override = process.env.TRADINGAI_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(process.cwd(), "data");
}
