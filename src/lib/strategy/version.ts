/**
 * Strategy version — Phase 15.
 * Versioned scoring weights; avoid silent rule changes.
 */

export type StrategyConfig = {
  version: string;
  name: string;
  weights: {
    technical: number;
    market: number;
    news: number;
    risk: number;
    volume: number;
    momentum: number;
    liquidity: number;
  };
  smallAccount: {
    defaultNotional: number;
    maxNotional: number;
    preferLiquid: boolean;
    avoidOtc: boolean;
  };
  changelog: string[];
};

const DEFAULT: StrategyConfig = {
  version: process.env.STRATEGY_VERSION?.trim() || "v1.0.0",
  name: "Paper Intelligence v1",
  weights: {
    technical: 0.32,
    market: 0.18,
    news: 0.12,
    risk: 0.14,
    volume: 0.1,
    momentum: 0.08,
    liquidity: 0.06,
  },
  smallAccount: {
    defaultNotional: 5,
    maxNotional: 10,
    preferLiquid: true,
    avoidOtc: true,
  },
  changelog: [
    "v1.0.0 — Extended scores (liquidity/volume/momentum), SKIP/WATCH labels, training loop.",
  ],
};

export function getStrategyConfig(): StrategyConfig {
  return { ...DEFAULT, weights: { ...DEFAULT.weights } };
}

export function getStrategyVersion(): string {
  return getStrategyConfig().version;
}
