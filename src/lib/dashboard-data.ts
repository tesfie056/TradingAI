import { checkOllamaHealth, getAiProviderName } from "@/lib/ai/provider";
import { generateWatchlistDecisions } from "@/lib/ai/decision";
import {
  appendDecisionHistory,
  pruneDecisionHistory,
  readPerformanceHistory,
  summarizePerformance,
} from "@/lib/ai/history";
import { updateDecisionOutcomes } from "@/lib/performance/update-outcomes";
import { runSimpleBacktest } from "@/lib/performance/backtest";
import {
  getAccount,
  getLatestBars,
  getLatestQuotes,
  getMarketClock,
  getOrders,
} from "@/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "@/lib/alpaca/safety";
import {
  getAlpacaCredentials,
  getWatchlist,
  isPaperOrderExecutionEnabled,
  PAPER_TRADING_BASE_URL,
} from "@/lib/config";
import { assessDataQuality } from "@/lib/market/data-quality";
import { analyzeWatchlistNews } from "@/lib/news/analyze";
import { fetchWatchlistNews } from "@/lib/news";
import type { DashboardData } from "@/lib/dashboard-types";
import {
  fetchMarketCondition,
  fetchMultiTimeframeBars,
} from "@/lib/stocks/fetch-context";

export async function loadDashboardData(): Promise<DashboardData> {
  try {
    const { baseUrl } = getAlpacaCredentials();
    assertPaperTradingOnly(baseUrl);

    const symbols = getWatchlist();
    const [
      account,
      clock,
      quotes,
      latestBars,
      multiBars,
      marketCondition,
      orders,
      newsResult,
    ] = await Promise.all([
      getAccount(),
      getMarketClock(),
      getLatestQuotes(symbols),
      getLatestBars(symbols),
      fetchMultiTimeframeBars(symbols),
      fetchMarketCondition(),
      getOrders(50),
      fetchWatchlistNews(symbols),
    ]);

    const { bySymbol: newsBySymbol, aiStatus } = await analyzeWatchlistNews(
      symbols,
      [...newsResult.items],
    );

    const decisions = generateWatchlistDecisions({
      symbols,
      quotes,
      barsBySymbol: multiBars.bars5Min,
      bars1MinBySymbol: multiBars.bars1Min,
      bars5MinBySymbol: multiBars.bars5Min,
      bars15MinBySymbol: multiBars.bars15Min,
      timeframe: "5Min",
      isMarketOpen: clock.isOpen,
      newsBySymbol,
      marketCondition,
    });

    await appendDecisionHistory(decisions, {
      aiProvider: aiStatus.activeProvider,
    });
    await updateDecisionOutcomes(120);
    await pruneDecisionHistory();
    const performanceHistory = await readPerformanceHistory(40);
    const performanceSummary = summarizePerformance(performanceHistory);
    const backtest = await runSimpleBacktest({
      symbols,
      lookbackBars: 60,
      step: 8,
      forwardBars: 6,
    });
    const ollamaHealth = await checkOllamaHealth();
    const requestedAi = getAiProviderName();
    const orderExecutionEnabled = isPaperOrderExecutionEnabled();
    const aiHealth = {
      paperOnly: true as const,
      orderExecutionEnabled,
      liveTradingAllowed: false as const,
      requestedProvider: requestedAi,
      ollama: {
        configured: ollamaHealth.ollamaConfigured,
        connected: ollamaHealth.connected,
        model: ollamaHealth.model,
        host: ollamaHealth.baseUrlHost,
        latencyMs: ollamaHealth.latencyMs,
        message: ollamaHealth.message,
      },
      statusLabel:
        requestedAi !== "ollama"
          ? ("heuristic" as const)
          : ollamaHealth.connected
            ? ("connected" as const)
            : ("fallback" as const),
    };

    const decisionBySymbol = new Map(decisions.map((d) => [d.symbol, d]));
    const recentBars = multiBars.bars5Min;

    const market = symbols.map((symbol) => {
      const quote = quotes.find((q) => q.symbol === symbol);
      const bar = latestBars[symbol];
      const bars = recentBars[symbol] ?? [];
      const mid =
        quote?.bid != null && quote?.ask != null
          ? (quote.bid + quote.ask) / 2
          : (quote?.bid ?? quote?.ask ?? bar?.close ?? null);
      const dataQuality =
        decisionBySymbol.get(symbol)?.dataQuality ??
        assessDataQuality({
          isMarketOpen: clock.isOpen,
          quote,
          bars,
        });

      return {
        symbol,
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        mid,
        last: bar?.close ?? null,
        timestamp: quote?.timestamp ?? bar?.timestamp ?? null,
        dataQuality,
        decision: decisionBySymbol.get(symbol) ?? null,
      };
    });

    return {
      ok: true,
      safety: {
        ok: true,
        paperOnly: true,
        liveTradingAllowed: false,
        tradingEndpoint: baseUrl,
      },
      account: {
        paperOnly: true,
        endpoint: PAPER_TRADING_BASE_URL,
        account: {
          cash: account.cash,
          equity: account.equity,
          portfolioValue: account.portfolio_value,
          buyingPower: account.buying_power,
          lastEquity: account.last_equity,
          status: account.status,
          currency: account.currency,
          accountNumber: account.account_number,
        },
      },
      clock,
      market: {
        watchlist: symbols,
        market,
        clock,
      },
      decisions,
      marketCondition,
      news: {
        provider: newsResult.provider,
        bySymbol: newsBySymbol,
        status: newsResult.status,
        aiStatus,
      },
      aiHealth,
      decisionHistory: performanceHistory.map((p) => ({
        symbol: p.symbol,
        action: p.action,
        confidence: p.confidence,
        reasons: p.reasons,
        riskWarnings: p.riskWarnings,
        timestamp: p.timestamp,
        paperOnly: true as const,
        priceAtDecision: p.priceAtDecision,
        marketOpen: p.marketOpen,
        newsSentiment: p.newsSentiment,
        aiProvider: p.aiProvider,
      })),
      performance: {
        history: performanceHistory,
        summary: performanceSummary,
      },
      backtest,
      trades: orders.map((o) => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        qty: o.qty,
        filledQty: o.filled_qty,
        filledAvgPrice: o.filled_avg_price,
        status: o.status,
        submittedAt: o.submitted_at,
        filledAt: o.filled_at,
      })),
      error: null,
      loadedAt: new Date().toISOString(),
      orderExecutionEnabled,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard";
    const safetyFail = error instanceof PaperTradingSafetyError;

    return {
      ok: false,
      safety: {
        ok: false,
        paperOnly: true,
        liveTradingAllowed: false,
        error: safetyFail ? message : undefined,
        tradingEndpoint: PAPER_TRADING_BASE_URL,
      },
      account: null,
      clock: null,
      market: null,
      decisions: [],
      marketCondition: null,
      news: null,
      aiHealth: null,
      decisionHistory: [],
      performance: null,
      backtest: null,
      trades: [],
      error: message,
      loadedAt: new Date().toISOString(),
      orderExecutionEnabled: false,
    };
  }
}
