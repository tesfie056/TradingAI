/**
 * Record learning events from live paper/auto-trade paths (additive).
 */

import {
  appendFeatureSnapshot,
  appendLearningEvent,
} from "@/lib/learning/dataset";
import { buildFeatureSnapshot } from "@/lib/learning/feature-snapshot";
import type {
  LearningEventType,
  LearningProposalBlock,
  LearningRiskBlock,
} from "@/lib/learning/types";
import { getChampionIdentity } from "@/lib/strategy/registry";
import type { AlpacaBar, AlpacaQuote } from "@/lib/alpaca/types";

export async function recordLearningDecision(input: {
  decisionId: string;
  eventType: LearningEventType;
  symbol: string;
  confidence: number | null;
  decisionTime?: string;
  isMarketOpen?: boolean | null;
  quote?: AlpacaQuote | null;
  bars5Min?: AlpacaBar[];
  bars1Min?: AlpacaBar[];
  bars15Min?: AlpacaBar[];
  spyBars?: AlpacaBar[];
  qqqBars?: AlpacaBar[];
  broaderMarketDirection?: string | null;
  proposal?: LearningProposalBlock | null;
  risk?: LearningRiskBlock | null;
  rejectionReason?: string | null;
  orderId?: string | null;
  orderStatus?: string | null;
  orderResult?: string | null;
}): Promise<void> {
  try {
    const champ = getChampionIdentity();
    const decisionTime = input.decisionTime ?? new Date().toISOString();
    const snapshot = buildFeatureSnapshot({
      decisionId: input.decisionId,
      symbol: input.symbol,
      decisionTime,
      strategyId: champ.strategyId,
      strategyVersion: champ.version,
      confidence: input.confidence,
      quote: input.quote,
      bars1Min: input.bars1Min,
      bars5Min: input.bars5Min,
      bars15Min: input.bars15Min,
      spyBars: input.spyBars,
      qqqBars: input.qqqBars,
      isMarketOpen: input.isMarketOpen,
      broaderMarketDirection: input.broaderMarketDirection,
    });
    await appendFeatureSnapshot(snapshot);
    await appendLearningEvent({
      eventType: input.eventType,
      decisionId: input.decisionId,
      symbol: input.symbol.toUpperCase(),
      decisionTime,
      strategyId: champ.strategyId,
      strategyVersion: champ.version,
      marketSession: snapshot.marketSession,
      regime: snapshot.regime,
      featureSnapshotId: snapshot.id,
      confidence: input.confidence,
      proposal: input.proposal ?? null,
      risk: input.risk ?? null,
      order: input.orderId
        ? {
            orderId: input.orderId,
            status: input.orderStatus ?? null,
            result: input.orderResult ?? null,
          }
        : null,
      outcomes: null,
      rejectionReason: input.rejectionReason ?? null,
    });

    // Shadow: same-snapshot challenger evaluation (never submits). Non-fatal.
    void (async () => {
      try {
        const { processShadowScan } = await import("@/lib/shadow/session");
        if (input.bars5Min && input.bars5Min.length > 0) {
          await processShadowScan({
            scanId: input.decisionId,
            timestamp: decisionTime,
            symbol: input.symbol,
            bars5Min: input.bars5Min,
            quote: input.quote,
            dataQualityStatus: "live",
            paperSubmitEligible: Boolean(input.orderId),
          });
        }
      } catch {
        /* shadow optional */
      }
    })();
  } catch {
    // Learning must never break trading
  }
}
