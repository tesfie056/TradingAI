import { getAiProviderName, getOllamaConfig } from "@/lib/ai/provider";
import {
  getDefaultNotionalAmount,
  getMaxStockPrice,
  isGeneralAiModeEnabled,
  isPaperOrderExecutionEnabled,
  isSmallAccountMode,
} from "@/lib/config";
import { SMALL_ACCOUNT_WARNINGS } from "@/lib/stocks/small-account";
import type {
  AiCommandDecisionContext,
  AiCommandRequest,
  AiCommandResponse,
  AiCommandSuggestedAction,
} from "@/lib/ai/command-types";
import {
  APP_SCOPE_ANSWER,
  classifyIntent,
  intentToQuickPrompt,
  isAppScopeQuestion,
  isHistoricalDataQuestion,
  isTradeRelatedIntent,
  OUT_OF_SCOPE_ANSWER,
  parseHistoricalField,
  shouldUseSelectedSymbol,
  type AiIntent,
  type QuickPromptKind,
} from "@/lib/ai/command-intent";
import {
  fetchYesterdaySession,
  formatYesterdaySessionAnswer,
} from "@/lib/ai/command-historical";

const SECRET_PATTERNS = [
  /FINNHUB_API_KEY/gi,
  /ALPACA_API_KEY/gi,
  /ALPACA_SECRET_KEY/gi,
  /APCA-API/gi,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /sk-[A-Za-z0-9]+/gi,
  /token=[^\s&"']+/gi,
  /secret[_-]?key\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  return out;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function normalizeAction(raw: unknown): AiCommandSuggestedAction {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (
    s === "analyze" ||
    s === "explain" ||
    s === "compare" ||
    s === "preview_only" ||
    s === "none"
  ) {
    return s;
  }
  return "none";
}

export type { QuickPromptKind };

/** Maps intents to heuristic switch cases (compat for verify scripts). */
export function classifyQuickPrompt(
  instruction: string,
  selectedSymbol?: string | null,
  conversation?: AiCommandRequest["conversation"],
): QuickPromptKind {
  const intent = classifyIntent(instruction, selectedSymbol, conversation);
  return intentToQuickPrompt(intent, instruction);
}

export {
  classifyIntent,
  isHistoricalDataQuestion,
  isAppScopeQuestion,
  shouldUseSelectedSymbol,
};

function extractSymbolsFromText(
  instruction: string,
  watchlist: string[] = [],
): string[] {
  const stop = new Set([
    "BUY",
    "SELL",
    "HOLD",
    "WHY",
    "THE",
    "AND",
    "FOR",
    "ALL",
    "HOW",
    "WHAT",
    "WHEN",
    "WITH",
    "FROM",
    "THIS",
    "THAT",
    "PAPER",
    "TRADE",
    "TRADES",
    "STOCK",
    "STOCKS",
    "MARKET",
    "NEWS",
    "RISK",
    "AI",
    "ONLY",
    "OPEN",
    "CLOSED",
    "COMPARE",
    "EXPLAIN",
    "ANALYZE",
    "SUMMARY",
    "SUMMARIZE",
    "STRONGEST",
    "HIGHEST",
    "CONFIDENCE",
    "SETUP",
    "TODAY",
    "WATCH",
    "WATCHLIST",
    "PREPARE",
    "PREVIEW",
    "SHOULD",
    "LOOKS",
    "FIND",
    "BLOCKED",
    "BLOCK",
    "ORDER",
    "ORDERS",
    "EXECUTION",
    "ARE",
    "IS",
    "WAS",
    "WERE",
    "BE",
    "BEEN",
    "MY",
    "ME",
    "YOU",
    "YOUR",
    "OUR",
    "NOT",
    "CAN",
    "WILL",
    "JUST",
    "INTO",
    "OVER",
    "UNDER",
    "HIGH",
    "HIGHEST",
    "LOW",
    "LOWEST",
    "CLOSE",
    "CLOSING",
    "VOLUME",
    "YESTERDAY",
    "SESSION",
    "PRIOR",
    "PREVIOUS",
    "LAST",
    "DAY",
    "ABOUT",
    "ALSO",
  ]);
  const watch = new Set(watchlist.map((s) => s.toUpperCase()));
  const all: string[] = [];
  const re = /\b([A-Za-z]{1,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(instruction)) !== null) {
    const sym = m[1].toUpperCase();
    if (stop.has(sym)) continue;
    if (!/^[A-Z]{1,5}$/.test(sym)) continue;
    if (!all.includes(sym)) all.push(sym);
  }
  if (watch.size > 0) {
    const inWatch = all.filter((s) => watch.has(s));
    return inWatch.slice(0, 6);
  }
  return all.slice(0, 6);
}

function pct(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function sortByConfidence(
  decisions: AiCommandDecisionContext[],
): AiCommandDecisionContext[] {
  return [...decisions].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

function sortByFinalScore(
  decisions: AiCommandDecisionContext[],
): AiCommandDecisionContext[] {
  return [...decisions].sort(
    (a, b) => (b.finalScore ?? b.confidence ?? 0) - (a.finalScore ?? a.confidence ?? 0),
  );
}

function findDecision(
  decisions: AiCommandDecisionContext[],
  symbol: string | null | undefined,
): AiCommandDecisionContext | undefined {
  if (!symbol) return undefined;
  return decisions.find((d) => d.symbol === symbol.toUpperCase());
}

function contextualSafetyWarnings(
  intent: AiIntent,
  executionEnabled: boolean,
  marketOpen: boolean | null | undefined,
  tradePreviewAllowed: boolean,
): string[] {
  // Non-trade questions: keep a single quiet reminder — never the main answer.
  if (!isTradeRelatedIntent(intent)) {
    return ["Paper trading desk — AI never submits orders."];
  }

  const warnings: string[] = [
    "Paper trading only — AI never submits orders.",
    "Live trading and automatic trading remain blocked.",
  ];
  if (marketOpen === false) {
    warnings.push("U.S. market is closed — paper submits stay blocked.");
  }
  if (!executionEnabled) {
    warnings.push(
      "Order execution is OFF — enable only in .env.local for manual paper submits.",
    );
  }
  if (tradePreviewAllowed) {
    warnings.push(
      "A paper preview is available — you must confirm manually before any order.",
    );
  }
  return warnings;
}

function buildResponse(args: {
  answer: string;
  relatedSymbols: string[];
  suggestedAction: AiCommandSuggestedAction;
  tradePreviewAllowed: boolean;
  previewHint: AiCommandResponse["previewHint"];
  provider: "ollama" | "heuristic";
  usedFallback: boolean;
  marketOpen?: boolean | null;
  intent?: AiIntent;
}): AiCommandResponse {
  const executionEnabled = isPaperOrderExecutionEnabled();
  const intent = args.intent ?? "general_out_of_scope";
  return {
    paperOnly: true,
    liveTradingAllowed: false,
    automaticTradingAllowed: false,
    orderExecutionEnabled: executionEnabled,
    answer: scrubSecrets(args.answer).trim(),
    relatedSymbols: args.relatedSymbols,
    suggestedAction: args.suggestedAction,
    safetyWarnings: contextualSafetyWarnings(
      intent,
      executionEnabled,
      args.marketOpen,
      args.tradePreviewAllowed,
    ),
    tradePreviewAllowed: args.tradePreviewAllowed,
    previewHint: args.tradePreviewAllowed ? args.previewHint : null,
    provider: args.provider,
    usedFallback: args.usedFallback,
    timestamp: new Date().toISOString(),
  };
}

function describeDecision(d: AiCommandDecisionContext): string {
  const parts = [
    `${d.symbol}: ${d.action} at ${pct(d.confidence)} confidence`,
    d.finalScore != null ? `final score ${pct(d.finalScore)}` : null,
    d.riskLevel ? `risk ${d.riskLevel}` : null,
    d.readyForManualPaperTrade
      ? "ready for paper preview"
      : "not ready for paper preview",
  ].filter(Boolean);
  return parts.join(", ");
}

function explainBlocks(d: AiCommandDecisionContext): string {
  if (d.readyForManualPaperTrade) {
    return "Gates look clear for a manual paper preview (still requires your confirmation).";
  }
  const reasons = d.tradeBlockReasons?.filter(Boolean) ?? [];
  if (reasons.length === 0) {
    return "Blocked by readiness gates (HOLD, risk, data quality, market hours, or execution lock).";
  }
  return `Blocked because: ${reasons.slice(0, 4).join("; ")}.`;
}

function accountLine(
  account:
    | {
        equity?: string | null;
        cash?: string | null;
        buyingPower?: string | null;
        currency?: string;
      }
    | null
    | undefined,
): string {
  if (!account) return "";
  const bits = [
    account.equity != null ? `equity ${account.equity}` : null,
    account.cash != null ? `cash ${account.cash}` : null,
    account.buyingPower != null ? `buying power ${account.buyingPower}` : null,
  ].filter(Boolean);
  return bits.length ? `Account (paper): ${bits.join(", ")}.` : "";
}

/** Build a compact, secret-free context summary for prompts and heuristics. */
export function summarizeCommandContext(input: AiCommandRequest): string {
  const ctx = input.context ?? {};
  const decisions = ctx.decisions ?? [];
  const executionEnabled =
    ctx.orderExecutionEnabled ?? isPaperOrderExecutionEnabled();
  const lines: string[] = [
    `Market open: ${ctx.marketOpen === true ? "yes" : ctx.marketOpen === false ? "no" : "unknown"}`,
    `Order execution: ${executionEnabled ? "ON (manual paper only)" : "OFF"}`,
    `Selected symbol: ${input.selectedSymbol ?? "none"}`,
    `Watchlist: ${(ctx.watchlist ?? decisions.map((d) => d.symbol)).join(", ") || "empty"}`,
  ];

  const acct = accountLine(ctx.account ?? null);
  if (acct) lines.push(acct);

  if (ctx.marketCondition) {
    lines.push(
      `Market condition: ${ctx.marketCondition.label ?? "—"} (score ${pct(ctx.marketCondition.marketScore)}) — ${ctx.marketCondition.explanation ?? ""}`,
    );
  }

  for (const d of decisions.slice(0, 12)) {
    lines.push(
      [
        describeDecision(d),
        d.technicalScore != null ? `tech ${pct(d.technicalScore)}` : null,
        d.newsScore != null ? `news ${pct(d.newsScore)}` : null,
        d.riskScore != null ? `riskScore ${pct(d.riskScore)}` : null,
        d.summary ? `summary: ${d.summary}` : null,
        d.technicalReason ? `technical: ${d.technicalReason}` : null,
        d.newsReason ? `news: ${d.newsReason}` : null,
        d.marketReason ? `market: ${d.marketReason}` : null,
        d.riskReason ? `risk: ${d.riskReason}` : null,
        explainBlocks(d),
      ]
        .filter(Boolean)
        .join(" | "),
    );
    const news = ctx.newsBySymbol?.[d.symbol];
    if (news?.explanation || news?.headlines?.length) {
      lines.push(
        `  News ${d.symbol}: ${news.overallSentiment ?? "n/a"} — ${news.explanation ?? ""} Headlines: ${(news.headlines ?? []).slice(0, 2).join(" | ")}`,
      );
    }
  }

  return scrubSecrets(lines.join("\n")).slice(0, 6000);
}

function previewForDecision(
  d: AiCommandDecisionContext | undefined,
): {
  tradePreviewAllowed: boolean;
  previewHint: AiCommandResponse["previewHint"];
} {
  if (
    d &&
    d.readyForManualPaperTrade === true &&
    (d.action === "BUY" || d.action === "SELL")
  ) {
    return {
      tradePreviewAllowed: true,
      previewHint: {
        symbol: d.symbol,
        side: d.action === "SELL" ? "sell" : "buy",
      },
    };
  }
  return { tradePreviewAllowed: false, previewHint: null };
}

function heuristicAnswer(input: AiCommandRequest): AiCommandResponse {
  const ctx = input.context ?? {};
  const decisions = ctx.decisions ?? [];
  const executionEnabled =
    ctx.orderExecutionEnabled ?? isPaperOrderExecutionEnabled();
  const intent = classifyIntent(
    input.userInstruction,
    input.selectedSymbol,
    input.conversation,
  );
  const kind = intentToQuickPrompt(intent, input.userInstruction);
  const symbolsInText = extractSymbolsFromText(
    input.userInstruction,
    ctx.watchlist ?? decisions.map((d) => d.symbol),
  );
  const useSelected = shouldUseSelectedSymbol(
    input.userInstruction,
    intent,
  );
  const selected =
    symbolsInText[0] ??
    (useSelected ? input.selectedSymbol?.toUpperCase() ?? null : null);

  const byConf = sortByConfidence(decisions);
  const byScore = sortByFinalScore(decisions);
  const strongest = byConf[0];
  const weakest = byConf[byConf.length - 1];
  const tradable = decisions.filter((d) => d.readyForManualPaperTrade);
  const blocked = decisions.filter((d) => !d.readyForManualPaperTrade);
  const acct = accountLine(ctx.account ?? null);

  let answer = "";
  let suggestedAction: AiCommandSuggestedAction = "explain";
  let relatedSymbols: string[] = [];
  let tradePreviewAllowed = false;
  let previewHint: AiCommandResponse["previewHint"] = null;

  switch (kind) {
    case "app_scope": {
      suggestedAction = "none";
      relatedSymbols = [];
      answer = APP_SCOPE_ANSWER;
      break;
    }
    case "out_of_scope": {
      suggestedAction = "none";
      relatedSymbols = [];
      answer = isGeneralAiModeEnabled()
        ? `${OUT_OF_SCOPE_ANSWER} (GENERAL_AI_MODE is on, but this desk still prioritizes trading help.)`
        : OUT_OF_SCOPE_ANSWER;
      break;
    }
    case "small_account": {
      suggestedAction = "analyze";
      const maxPrice = getMaxStockPrice();
      const defaultNotional = getDefaultNotionalAmount();
      const affordable = decisions.filter(
        (d) =>
          d.lastPrice != null &&
          d.lastPrice <= maxPrice &&
          d.lastPrice >= 2,
      );
      const safest = [...affordable]
        .filter((d) => d.readyForManualPaperTrade)
        .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0))[0];
      relatedSymbols = affordable.slice(0, 8).map((d) => d.symbol);
      answer = [
        isSmallAccountMode()
          ? "Small Account Mode is ON — paper trades can use dollar amounts (notional) for fractional shares."
          : "Small Account Mode is OFF in server config, but I can still filter by price and quality.",
        `Default paper size: ~$${defaultNotional.toFixed(2)} (notional) · max price cap $${maxPrice}.`,
        affordable.length
          ? `Under $${maxPrice}: ${affordable.map((d) => `${d.symbol} ($${d.lastPrice?.toFixed(2) ?? "—"})`).join(", ")}.`
          : `No watchlist names under $${maxPrice} with loaded quotes.`,
        safest
          ? `Safest-looking under cap today: ${safest.symbol} (${safest.action}, ${pct(safest.confidence)} conf).`
          : "No under-cap name is fully ready for manual paper trade right now.",
        SMALL_ACCOUNT_WARNINGS.join(" "),
        `Recommend $5–$10 paper test sizes (notional) — default $${defaultNotional.toFixed(0)}. Avoid buying 1 full share of expensive names; use dollar amount mode instead. Only use $50 if you intentionally raise the amount.`,
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "analyze_watchlist":
    case "generic": {
      if (intent === "general_out_of_scope" || intent === "app_scope_question") {
        suggestedAction = "none";
        relatedSymbols = [];
        answer =
          intent === "app_scope_question" ? APP_SCOPE_ANSWER : OUT_OF_SCOPE_ANSWER;
        break;
      }
      suggestedAction = "analyze";
      relatedSymbols = decisions.slice(0, 8).map((d) => d.symbol);
      const buys = decisions.filter((d) => d.action === "BUY").length;
      const sells = decisions.filter((d) => d.action === "SELL").length;
      const holds = decisions.filter((d) => d.action === "HOLD").length;
      const topLines = byScore
        .slice(0, 3)
        .map(
          (d) =>
            `${d.symbol} ${d.action} (${pct(d.confidence)} conf${d.finalScore != null ? `, score ${pct(d.finalScore)}` : ""}${d.riskLevel ? `, risk ${d.riskLevel}` : ""})`,
        );
      answer = [
        decisions.length === 0
          ? "No watchlist decisions are loaded yet. Refresh the Dashboard first."
          : `Watchlist snapshot: ${buys} BUY · ${sells} SELL · ${holds} HOLD across ${decisions.length} stocks.`,
        strongest
          ? `Strongest confidence: ${strongest.symbol} (${strongest.action}, ${pct(strongest.confidence)}).`
          : "",
        weakest && weakest.symbol !== strongest?.symbol
          ? `Weakest confidence: ${weakest.symbol} (${weakest.action}, ${pct(weakest.confidence)}).`
          : "",
        `${tradable.length} name(s) ready for a manual paper preview; ${blocked.length} blocked.`,
        topLines.length ? `Top setups: ${topLines.join("; ")}.` : "",
        acct,
        "Ask about a specific ticker for a deeper explanation. AI cannot place orders.",
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "strongest":
    case "highest_confidence": {
      suggestedAction = "analyze";
      if (!strongest) {
        answer =
          "No decisions are loaded yet. Refresh the Dashboard watchlist first.";
        suggestedAction = "none";
        break;
      }
      relatedSymbols = [strongest.symbol];
      const preview = previewForDecision(strongest);
      tradePreviewAllowed = preview.tradePreviewAllowed;
      previewHint = preview.previewHint;
      if (tradePreviewAllowed) suggestedAction = "preview_only";
      answer = [
        kind === "highest_confidence"
          ? `Highest confidence setup: ${strongest.symbol} → ${strongest.action} at ${pct(strongest.confidence)}.`
          : `Strongest-looking name right now: ${strongest.symbol} → ${strongest.action} at ${pct(strongest.confidence)}.`,
        strongest.finalScore != null
          ? `Final score ${pct(strongest.finalScore)}.`
          : "",
        strongest.summary ?? "",
        strongest.technicalReason
          ? `Technical: ${strongest.technicalReason}`
          : "",
        strongest.newsReason ? `News: ${strongest.newsReason}` : "",
        strongest.riskReason ? `Risk: ${strongest.riskReason}` : "",
        tradePreviewAllowed
          ? "You can prepare a manual paper trade preview — AI will not submit it."
          : "This is analysis only — not a trade recommendation to execute.",
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "why_blocked": {
      suggestedAction = "explain";
      relatedSymbols = blocked.slice(0, 6).map((d) => d.symbol);
      const globalBits = [
        ctx.marketOpen === false
          ? "The U.S. equity market is closed, so all paper trades are blocked."
          : null,
        !executionEnabled
          ? "Order execution is OFF by default, so paper submits cannot go through even if a preview looks ready."
          : null,
      ].filter(Boolean);

      if (selected) {
        const d = findDecision(decisions, selected);
        relatedSymbols = d ? [d.symbol] : [selected];
        if (d) {
          answer = [
            d.action === "HOLD"
              ? `${d.symbol} is HOLD at ${pct(d.confidence)} confidence — the model is not recommending a trade.`
              : `${d.symbol} decision is ${d.action} at ${pct(d.confidence)}.`,
            d.summary ?? "",
            explainBlocks(d),
            d.riskReason ? `Risk in plain English: ${d.riskReason}` : "",
            d.technicalReason ? `Technical: ${d.technicalReason}` : "",
            d.newsReason ? `News: ${d.newsReason}` : "",
            ...globalBits,
            "AI never places orders — only a manual paper preview with your confirmation is allowed.",
          ]
            .filter(Boolean)
            .join(" ");
        } else {
          answer = `No decision loaded for ${selected}. Refresh the watchlist, then ask again.`;
          suggestedAction = "none";
        }
        break;
      }

      const examples = blocked
        .slice(0, 5)
        .map((d) => {
          const r =
            d.tradeBlockReasons?.slice(0, 2).join("; ") ||
            (d.action === "HOLD" ? "HOLD / not tradable" : "not tradable");
          return `${d.symbol}: ${r}`;
        })
        .join(" · ");

      answer = [
        ...globalBits,
        blocked.length === 0 && tradable.length > 0
          ? `${tradable.length} name(s) look ready for a manual paper preview — expand a row and use Prepare if you want to review.`
          : `${blocked.length} of ${decisions.length} watchlist names are blocked by risk, data quality, HOLD, or market gates.`,
        examples ? `Examples: ${examples}.` : "Refresh the Dashboard to load block reasons.",
        "Paper preview is required before any order, and AI cannot submit.",
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "market_news_risk": {
      suggestedAction = "explain";
      relatedSymbols = (ctx.watchlist ?? decisions.map((d) => d.symbol)).slice(
        0,
        5,
      );
      const negativeNews = decisions.filter((d) => {
        const n = ctx.newsBySymbol?.[d.symbol];
        return (
          n?.overallSentiment === "negative" ||
          (d.newsScore != null && d.newsScore < 0.4)
        );
      });
      const highRisk = decisions.filter(
        (d) => d.riskLevel === "high" || (d.riskScore != null && d.riskScore < 0.4),
      );
      answer = [
        ctx.marketCondition?.label
          ? `Market condition looks ${ctx.marketCondition.label} (score ${pct(ctx.marketCondition.marketScore)}).`
          : "Market condition (SPY/QQQ) is unavailable right now.",
        ctx.marketCondition?.explanation ?? "",
        highRisk.length
          ? `Higher risk names: ${highRisk
              .slice(0, 4)
              .map((d) => d.symbol)
              .join(", ")}.`
          : "No watchlist names are flagged high risk right now.",
        negativeNews.length
          ? `More cautious news tone on: ${negativeNews
              .slice(0, 4)
              .map((d) => d.symbol)
              .join(", ")}.`
          : "News tone across the watchlist looks mixed-to-neutral.",
        "This is a market/news summary only — not a trade instruction.",
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "compare": {
      suggestedAction = "compare";
      const pair =
        symbolsInText.length >= 2
          ? symbolsInText.slice(0, 2)
          : selected && symbolsInText[0] && selected !== symbolsInText[0]
            ? [selected, symbolsInText[0]]
            : byConf.slice(0, 2).map((d) => d.symbol);
      const a = findDecision(decisions, pair[0]);
      const b = findDecision(decisions, pair[1]);
      relatedSymbols = [pair[0], pair[1]].filter(Boolean) as string[];
      if (!a || !b) {
        answer = `I need two loaded watchlist symbols to compare. Try “Compare AAPL and NVDA” after refreshing.`;
        suggestedAction = "none";
        break;
      }
      const aScore = a.finalScore ?? a.confidence;
      const bScore = b.finalScore ?? b.confidence;
      const leader = aScore >= bScore ? a : b;
      answer = [
        `Comparing ${a.symbol} vs ${b.symbol} (paper analysis only).`,
        `${a.symbol}: ${a.action}, confidence ${pct(a.confidence)}${a.finalScore != null ? `, final ${pct(a.finalScore)}` : ""}, risk ${a.riskLevel ?? "—"}.`,
        a.summary ?? "",
        `${b.symbol}: ${b.action}, confidence ${pct(b.confidence)}${b.finalScore != null ? `, final ${pct(b.finalScore)}` : ""}, risk ${b.riskLevel ?? "—"}.`,
        b.summary ?? "",
        `Edge right now: ${leader.symbol} looks stronger on score/confidence.`,
        "Comparison only — AI cannot place orders.",
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "prepare_preview":
    case "trade_execution": {
      suggestedAction = "preview_only";
      const target =
        findDecision(decisions, selected) ??
        tradable[0] ??
        strongest;
      relatedSymbols = target ? [target.symbol] : selected ? [selected] : [];
      const preview = previewForDecision(target);
      tradePreviewAllowed = preview.tradePreviewAllowed;
      previewHint = preview.previewHint;
      const wantsExec = kind === "trade_execution";
      answer = [
        wantsExec
          ? "I cannot buy, sell, or submit any order — not even paper orders."
          : "I can help prepare a manual paper trade preview only.",
        target
          ? `For ${target.symbol}: current paper decision is ${target.action} at ${pct(target.confidence)}.`
          : "No watchlist decision is loaded for a preview yet.",
        target?.summary ?? "",
        explainBlocks(
          target ?? {
            symbol: selected ?? "?",
            action: "HOLD",
            confidence: 0,
          },
        ),
        tradePreviewAllowed
          ? "A manual paper trade preview is allowed — use Prepare, review gates, then confirm yourself."
          : "A paper trade preview is not allowed right now (blocked gates, HOLD, high risk, market closed, or data issues).",
        ctx.marketOpen === false
          ? "Market is closed, so paper submits stay blocked."
          : "",
        !executionEnabled
          ? "Order execution is OFF — submits stay locked until enabled in .env.local."
          : "Even with execution ON, only manual confirmation can submit a paper order.",
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "watch_open": {
      suggestedAction = "analyze";
      relatedSymbols = byScore.slice(0, 5).map((d) => d.symbol);
      answer = [
        ctx.marketOpen === false
          ? "When the U.S. market opens, start with names that already have the cleanest setup and lowest block risk."
          : "Market is already open — focus on the cleanest setups and avoid chasing blocked names.",
        strongest
          ? `Priority watch: ${strongest.symbol} (${strongest.action}, ${pct(strongest.confidence)}).`
          : "",
        tradable.length
          ? `Currently preview-ready: ${tradable
              .slice(0, 4)
              .map((d) => d.symbol)
              .join(", ")}.`
          : "Nothing is preview-ready yet — wait for clearer scores and open-market data.",
        highRiskLine(decisions),
        ctx.marketCondition?.explanation
          ? `Market backdrop: ${ctx.marketCondition.explanation}`
          : "",
        "At the open, re-check spreads, freshness, and news. Paper preview + manual confirmation are still required. AI never submits.",
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "explain_symbol": {
      suggestedAction = "explain";
      const sym = selected ?? symbolsInText[0];
      const decision = findDecision(decisions, sym);
      relatedSymbols = sym ? [sym] : [];
      const news = sym ? ctx.newsBySymbol?.[sym] : undefined;
      if (!decision || !sym) {
        answer = `No decision loaded for ${sym ?? "that symbol"}. Refresh the watchlist, then ask again.`;
        suggestedAction = "none";
        break;
      }
      const preview = previewForDecision(decision);
      tradePreviewAllowed = preview.tradePreviewAllowed;
      previewHint = preview.previewHint;
      if (tradePreviewAllowed) suggestedAction = "preview_only";
      answer = [
        `${sym}: paper decision ${decision.action} at ${pct(decision.confidence)} confidence` +
          (decision.finalScore != null
            ? ` (final score ${pct(decision.finalScore)})`
            : "") +
          (decision.riskLevel ? `, risk ${decision.riskLevel}` : "") +
          ".",
        decision.summary ?? "",
        decision.action === "HOLD"
          ? `Why HOLD: the combined technical, news, market, and risk picture is not strong enough for a BUY/SELL suggestion.`
          : "",
        decision.technicalReason
          ? `Technical: ${decision.technicalReason}`
          : decision.technicalScore != null
            ? `Technical score ${pct(decision.technicalScore)}.`
            : "",
        decision.newsReason
          ? `News: ${decision.newsReason}`
          : news?.explanation
            ? `News: ${news.explanation}`
            : "",
        news?.headlines?.length
          ? `Headlines: ${news.headlines.slice(0, 2).join(" | ")}.`
          : "",
        decision.marketReason
          ? `Market: ${decision.marketReason}`
          : "",
        decision.riskReason
          ? `Risk: ${decision.riskReason}`
          : "",
        explainBlocks(decision),
        tradePreviewAllowed
          ? "You may prepare a manual paper trade preview — AI will not submit it."
          : "This is an explanation only — not a live trade signal.",
      ]
        .filter(Boolean)
        .join(" ");
      break;
    }
    case "historical_data": {
      answer =
        "Ask a historical price question with a symbol, for example: “What was AAPL high yesterday?”";
      suggestedAction = "none";
      break;
    }
  }

  return buildResponse({
    answer,
    relatedSymbols,
    suggestedAction,
    tradePreviewAllowed,
    previewHint,
    provider: "heuristic",
    usedFallback: false,
    marketOpen: ctx.marketOpen,
    intent,
  });
}

function highRiskLine(decisions: AiCommandDecisionContext[]): string {
  const high = decisions.filter((d) => d.riskLevel === "high");
  if (!high.length) return "No high-risk flags on the current watchlist.";
  return `Treat carefully: ${high.map((d) => d.symbol).join(", ")} flagged high risk.`;
}

async function ollamaCommandAnswer(
  input: AiCommandRequest,
  intent: AiIntent,
): Promise<AiCommandResponse | null> {
  if (intent === "app_scope_question") {
    return buildResponse({
      answer: APP_SCOPE_ANSWER,
      relatedSymbols: [],
      suggestedAction: "none",
      tradePreviewAllowed: false,
      previewHint: null,
      provider: "heuristic",
      usedFallback: false,
      marketOpen: input.context?.marketOpen,
      intent,
    });
  }
  if (intent === "general_out_of_scope") {
    return buildResponse({
      answer: OUT_OF_SCOPE_ANSWER,
      relatedSymbols: [],
      suggestedAction: "none",
      tradePreviewAllowed: false,
      previewHint: null,
      provider: "heuristic",
      usedFallback: false,
      marketOpen: input.context?.marketOpen,
      intent,
    });
  }

  const { baseUrl, model, timeoutMs } = getOllamaConfig();
  const ctx = input.context ?? {};
  const executionEnabled =
    ctx.orderExecutionEnabled ?? isPaperOrderExecutionEnabled();
  const summary = summarizeCommandContext(input);
  const kind = intentToQuickPrompt(intent, input.userInstruction);
  const tradeIntent = isTradeRelatedIntent(intent);
  const useSelected = shouldUseSelectedSymbol(input.userInstruction, intent);

  const prompt = [
    "You are TradingAI, a helpful U.S. stocks PAPER-TRADING desk assistant.",
    "Rules (must follow):",
    "- Stocks only. No crypto. No options.",
    "- Paper trading only. No live trading. No automatic trading.",
    "- You NEVER place, submit, or execute orders.",
    "- Answer the user's question directly first.",
    "- Do NOT describe a random watchlist stock unless the user asked about that symbol.",
    useSelected
      ? `- Selected symbol focus is allowed: ${input.selectedSymbol}`
      : "- Ignore any selected symbol — the user did not ask about it.",
    "- Do NOT say trades are blocked unless the user asked about trading, blocks, preview, or execution.",
    "- Market closed / order execution OFF are irrelevant for historical prices, explanations, comparisons, and news summaries.",
    tradeIntent
      ? "- For trade/preview requests: explain analysis, refuse submission, and mention market/execution status when it blocks submits."
      : "- Do not lead with market-closed or execution-off warnings.",
    "- Do not invent prices. If historical OHLC is not in context, say you need the historical data path.",
    "- Do not mention API keys, secrets, tokens, or env var values.",
    "",
    "Return JSON only with this shape:",
    '{"answer":"helpful simple English","relatedSymbols":["AAPL"],"suggestedAction":"analyze|explain|compare|preview_only|none","tradePreviewAllowed":false,"previewHint":null}',
    'previewHint is null or {"symbol":"AAPL","side":"buy"|"sell"}.',
    "Set tradePreviewAllowed true ONLY if context says that symbol is ready for manual paper preview AND action is BUY or SELL.",
    "",
    `Detected intent: ${intent} (${kind})`,
    `User question: ${input.userInstruction.slice(0, 500)}`,
    tradeIntent
      ? `Order execution enabled (server): ${executionEnabled ? "yes" : "no"}`
      : "Order execution status: omit from answer unless user asked about trading.",
    "",
    "Dashboard context:",
    summary,
  ].join("\n");

  const commandTimeout = Math.min(Math.max(timeoutMs, 15_000), 90_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), commandTimeout);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: scrubSecrets(prompt),
        stream: false,
        format: "json",
        options: { temperature: 0.25, num_predict: 520 },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    const parsed = extractJsonObject(String(data.response ?? ""));
    if (!parsed) return null;

    let answer = scrubSecrets(String(parsed.answer ?? "").trim());
    if (!answer || answer.length < 40) {
      return null;
    }

    const safetyOnly =
      /paper only|never (place|submit)|no automatic|no trades can be made/i.test(
        answer,
      ) &&
      !/\b[A-Z]{1,5}\b/.test(
        answer.replace(/HOLD|BUY|SELL|PAPER|ONLY|AI|OFF|ON/g, ""),
      );
    if (safetyOnly) return null;

    // Reject over-blocking answers on non-trade questions.
    if (
      !tradeIntent &&
      /no trades can be made|cannot trade|order execution is off.*market is closed|market is closed.*order execution/i.test(
        answer,
      ) &&
      !/why|block/i.test(input.userInstruction)
    ) {
      return null;
    }

    const relatedSymbols = Array.isArray(parsed.relatedSymbols)
      ? parsed.relatedSymbols
          .map((s) => String(s).toUpperCase())
          .filter((s) => /^[A-Z]{1,5}$/.test(s))
          .slice(0, 8)
      : [];

    let previewHint: AiCommandResponse["previewHint"] = null;
    const hint = parsed.previewHint;
    if (hint && typeof hint === "object") {
      const h = hint as { symbol?: unknown; side?: unknown };
      const symbol = String(h.symbol ?? "")
        .toUpperCase()
        .trim();
      const side = String(h.side ?? "").toLowerCase();
      if (/^[A-Z]{1,5}$/.test(symbol) && (side === "buy" || side === "sell")) {
        const d = findDecision(ctx.decisions ?? [], symbol);
        const allowed = previewForDecision(d);
        if (allowed.tradePreviewAllowed) {
          previewHint = { symbol, side };
        }
      }
    }

    const tradePreviewAllowed = previewHint != null;
    let suggestedAction = normalizeAction(parsed.suggestedAction);
    if (
      intent === "trade_preview_request" ||
      intent === "trade_execution"
    ) {
      suggestedAction = "preview_only";
    }
    if (intent === "comparison") suggestedAction = "compare";
    if (tradePreviewAllowed && suggestedAction === "none") {
      suggestedAction = "preview_only";
    }

    if (tradeIntent) {
      const footerBits: string[] = [];
      if (ctx.marketOpen === false && !/market is closed/i.test(answer)) {
        footerBits.push("Market is closed.");
      }
      if (!executionEnabled && !/execution is off/i.test(answer)) {
        footerBits.push("Order execution is OFF.");
      }
      if (footerBits.length) {
        answer = `${answer} ${footerBits.join(" ")}`;
      }
    }

    const fallbackSymbols =
      intent === "watchlist_analysis" || intent === "market_summary"
        ? (ctx.decisions ?? []).slice(0, 3).map((d) => d.symbol)
        : [];

    return buildResponse({
      answer,
      relatedSymbols:
        relatedSymbols.length > 0 ? relatedSymbols : fallbackSymbols,
      suggestedAction,
      tradePreviewAllowed,
      previewHint,
      provider: "ollama",
      usedFallback: false,
      marketOpen: ctx.marketOpen,
      intent,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function answerHistoricalQuestion(
  input: AiCommandRequest,
): Promise<AiCommandResponse> {
  const ctx = input.context ?? {};
  const watchlist =
    ctx.watchlist ?? (ctx.decisions ?? []).map((d) => d.symbol);
  const follow = input.userInstruction
    .trim()
    .match(/^(what about|how about|and|also)\s+([A-Za-z]{1,5})\??$/i);
  const symbols = extractSymbolsFromText(input.userInstruction, watchlist);
  const intent: AiIntent = "historical_price_question";
  const useSelected = shouldUseSelectedSymbol(input.userInstruction, intent);
  const symbol =
    (follow?.[2] ? follow[2].toUpperCase() : null) ??
    symbols[0] ??
    (useSelected ? input.selectedSymbol?.toUpperCase() ?? null : null);

  const fieldSource =
    follow && input.conversation?.lastInstruction
      ? input.conversation.lastInstruction
      : input.userInstruction;
  const field = parseHistoricalField(fieldSource);

  if (!symbol) {
    const choices =
      watchlist.length > 0
        ? watchlist.slice(0, 8).join(", ")
        : "AAPL, MSFT, GOOGL, AMZN, or NVDA";
    return buildResponse({
      answer: `Which symbol do you mean? ${choices}?`,
      relatedSymbols: watchlist.slice(0, 5),
      suggestedAction: "none",
      tradePreviewAllowed: false,
      previewHint: null,
      provider: "heuristic",
      usedFallback: false,
      marketOpen: ctx.marketOpen,
      intent,
    });
  }

  try {
    const session = await fetchYesterdaySession(symbol);
    if (!session) {
      return buildResponse({
        answer: `I could not load yesterday’s daily bar for ${symbol} right now. Try again in a moment, or refresh the desk.`,
        relatedSymbols: [symbol],
        suggestedAction: "none",
        tradePreviewAllowed: false,
        previewHint: null,
        provider: "heuristic",
        usedFallback: false,
        marketOpen: ctx.marketOpen,
        intent,
      });
    }
    return buildResponse({
      answer: formatYesterdaySessionAnswer(session, field),
      relatedSymbols: [symbol],
      suggestedAction: "explain",
      tradePreviewAllowed: false,
      previewHint: null,
      provider: "heuristic",
      usedFallback: false,
      marketOpen: ctx.marketOpen,
      intent,
    });
  } catch (err) {
    return buildResponse({
      answer: `I could not fetch historical bars for ${symbol}: ${
        err instanceof Error ? err.message : "data error"
      }. This is still analysis only — no orders were placed.`,
      relatedSymbols: [symbol],
      suggestedAction: "none",
      tradePreviewAllowed: false,
      previewHint: null,
      provider: "heuristic",
      usedFallback: true,
      marketOpen: ctx.marketOpen,
      intent,
    });
  }
}

/**
 * Run an AI command. Never submits orders. May only suggest preview_only.
 */
export async function runAiCommand(
  input: AiCommandRequest,
): Promise<AiCommandResponse> {
  const instruction = input.userInstruction?.trim() ?? "";
  if (!instruction) {
    return buildResponse({
      answer: "Enter a question for the paper-trading assistant.",
      relatedSymbols: [],
      suggestedAction: "none",
      tradePreviewAllowed: false,
      previewHint: null,
      provider: "heuristic",
      usedFallback: false,
      marketOpen: input.context?.marketOpen,
      intent: "general_out_of_scope",
    });
  }

  const safeInput: AiCommandRequest = {
    ...input,
    userInstruction: scrubSecrets(instruction).slice(0, 800),
    selectedSymbol: input.selectedSymbol?.toUpperCase() ?? null,
    conversation: input.conversation ?? null,
    context: input.context
      ? {
          ...input.context,
          orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        }
      : {
          orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        },
  };

  if (safeInput.context?.decisions) {
    safeInput.context.decisions = safeInput.context.decisions.map((d) => ({
      ...d,
      summary: d.summary ? scrubSecrets(d.summary) : d.summary,
      technicalReason: d.technicalReason
        ? scrubSecrets(d.technicalReason)
        : d.technicalReason,
      newsReason: d.newsReason ? scrubSecrets(d.newsReason) : d.newsReason,
      marketReason: d.marketReason
        ? scrubSecrets(d.marketReason)
        : d.marketReason,
      riskReason: d.riskReason ? scrubSecrets(d.riskReason) : d.riskReason,
      tradeBlockReasons: d.tradeBlockReasons?.map(scrubSecrets),
    }));
  }

  const intent = classifyIntent(
    safeInput.userInstruction,
    safeInput.selectedSymbol,
    safeInput.conversation,
  );

  if (intent === "historical_price_question") {
    return answerHistoricalQuestion(safeInput);
  }

  if (intent === "app_scope_question") {
    return buildResponse({
      answer: APP_SCOPE_ANSWER,
      relatedSymbols: [],
      suggestedAction: "none",
      tradePreviewAllowed: false,
      previewHint: null,
      provider: "heuristic",
      usedFallback: false,
      marketOpen: safeInput.context?.marketOpen,
      intent,
    });
  }

  if (intent === "general_out_of_scope" && !isGeneralAiModeEnabled()) {
    return buildResponse({
      answer: OUT_OF_SCOPE_ANSWER,
      relatedSymbols: [],
      suggestedAction: "none",
      tradePreviewAllowed: false,
      previewHint: null,
      provider: "heuristic",
      usedFallback: false,
      marketOpen: safeInput.context?.marketOpen,
      intent,
    });
  }

  if (getAiProviderName() === "ollama") {
    const ollama = await ollamaCommandAnswer(safeInput, intent);
    if (ollama) return ollama;
    const fallback = heuristicAnswer(safeInput);
    return { ...fallback, usedFallback: true };
  }

  return heuristicAnswer(safeInput);
}
