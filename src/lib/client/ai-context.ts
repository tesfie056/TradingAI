/**
 * Build a lightweight AI context snapshot from live APIs.
 * Safe to call from any page — no secrets included.
 */

import { fetchJson } from "@/lib/client/fetch-json";
import type { AiCommandRequest } from "@/lib/ai/command-types";
import type { MarketClockStatus } from "@/lib/alpaca/types";
import type {
  AccountPayload,
  DecisionPayload,
  MarketPayload,
} from "@/lib/dashboard-types";

export async function buildAiContextSnapshot(): Promise<{
  context: AiCommandRequest["context"];
  orderExecutionEnabled: boolean;
  selectedSymbolFallback: string | null;
}> {
  const [account, market, decision, clock] = await Promise.all([
    fetchJson<AccountPayload>("/api/account").catch(() => null),
    fetchJson<MarketPayload>("/api/market").catch(() => null),
    fetchJson<DecisionPayload>("/api/ai/decision").catch(() => null),
    fetchJson<{ clock: MarketClockStatus }>("/api/market/clock").catch(
      () => null,
    ),
  ]);

  const currency = account?.account.currency ?? "USD";
  const decisions = decision?.decisions ?? [];
  const newsBySymbol = decision?.news?.bySymbol ?? {};

  return {
    orderExecutionEnabled: decision?.orderExecutionEnabled ?? false,
    selectedSymbolFallback: decisions[0]?.symbol ?? market?.watchlist?.[0] ?? null,
    context: {
      watchlist: market?.watchlist ?? [],
      marketOpen: clock?.clock?.isOpen ?? decision?.clock?.isOpen ?? null,
      orderExecutionEnabled: decision?.orderExecutionEnabled ?? false,
      account: account
        ? {
            equity: account.account.equity,
            cash: account.account.cash,
            buyingPower: account.account.buyingPower,
            currency,
          }
        : null,
      marketCondition: decision?.marketCondition
        ? {
            label: decision.marketCondition.label,
            explanation: decision.marketCondition.explanation,
            marketScore: decision.marketCondition.marketScore,
          }
        : null,
      decisions: decisions.map((d) => ({
        symbol: d.symbol,
        action: d.action,
        confidence: d.confidence,
        riskLevel: d.riskLevel ?? d.riskStatus,
        finalScore: d.scores?.finalScore,
        technicalScore: d.scores?.technicalScore,
        marketScore: d.scores?.marketScore,
        newsScore: d.scores?.newsScore,
        riskScore: d.scores?.riskScore,
        tradeBlockReasons: d.tradeBlockReasons,
        readyForManualPaperTrade: d.readyForManualPaperTrade,
        summary: d.explanation?.summary ?? d.reasons[0],
        technicalReason: d.explanation?.technical,
        newsReason: d.explanation?.news ?? d.newsContext?.explanation,
        marketReason:
          d.explanation?.market ?? d.marketCondition?.explanation,
        riskReason: d.explanation?.risk,
        lastPrice: d.metrics?.last ?? null,
      })),
      newsBySymbol: Object.fromEntries(
        Object.entries(newsBySymbol).map(([sym, n]) => [
          sym,
          {
            overallSentiment: n.overallSentiment,
            explanation: n.explanation,
            headlines: n.items?.slice(0, 3).map((i) => i.headline) ?? [],
          },
        ]),
      ),
    },
  };
}
