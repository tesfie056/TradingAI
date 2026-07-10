"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AiCommandCenter } from "@/components/AiCommandCenter";
import { PageHeader } from "@/components/layout/PageHeader";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { fetchJson } from "@/lib/client/fetch-json";
import type { AiCommandRequest } from "@/lib/ai/command-types";
import type { MarketClockStatus } from "@/lib/alpaca/types";
import type {
  AccountPayload,
  DecisionPayload,
  MarketPayload,
} from "@/lib/dashboard-types";
import type { MarketCondition } from "@/lib/stocks/market-condition";

export function AiAssistantPage() {
  const router = useRouter();
  const [orderExecutionEnabled, setOrderExecutionEnabled] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [context, setContext] = useState<AiCommandRequest["context"] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [account, market, decision, clock] = await Promise.all([
          fetchJson<AccountPayload>("/api/account").catch(() => null),
          fetchJson<MarketPayload>("/api/market").catch(() => null),
          fetchJson<DecisionPayload>("/api/ai/decision").catch(() => null),
          fetchJson<{ clock: MarketClockStatus }>("/api/market/clock").catch(
            () => null,
          ),
        ]);
        if (cancelled) return;

        const marketCondition: MarketCondition | null =
          decision?.marketCondition ?? null;
        const currency = account?.account.currency ?? "USD";
        const decisions = decision?.decisions ?? [];
        const newsBySymbol = decision?.news?.bySymbol ?? {};

        setOrderExecutionEnabled(
          decision?.orderExecutionEnabled ?? false,
        );
        setContext({
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
          marketCondition: marketCondition
            ? {
                label: marketCondition.label,
                explanation: marketCondition.explanation,
                marketScore: marketCondition.marketScore,
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
        });
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load assistant context",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildContext = useCallback((): AiCommandRequest["context"] => {
    return (
      context ?? {
        watchlist: [],
        marketOpen: null,
        orderExecutionEnabled,
        account: null,
        marketCondition: null,
        decisions: [],
        newsBySymbol: {},
      }
    );
  }, [context, orderExecutionEnabled]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="AI Assistant"
        description="Trading desk chat for U.S. stocks. Explains and suggests — never places orders."
      />
      <SafetyBanner orderExecutionEnabled={orderExecutionEnabled} />
      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-base text-rose-100">
          {error}
        </div>
      ) : null}
      {loading ? (
        <p className="text-base text-[var(--muted)]">Loading desk context…</p>
      ) : (
        <AiCommandCenter
          open
          variant="page"
          onClose={() => router.push("/dashboard")}
          orderExecutionEnabled={orderExecutionEnabled}
          selectedSymbol={selectedSymbol}
          buildContext={buildContext}
          onSelectSymbol={setSelectedSymbol}
          onPreparePreview={(symbol, side) => {
            router.push(
              `/trade?symbol=${encodeURIComponent(symbol)}&side=${side}`,
            );
          }}
        />
      )}
    </div>
  );
}
