/**
 * AI Assistant intent classification.
 * Market closed / execution OFF only matter for trade preview & execution intents.
 * selectedSymbol must NOT force stock answers for scope/general questions.
 */

export type AiIntent =
  | "app_scope_question"
  | "stock_question"
  | "historical_price_question"
  | "market_summary"
  | "watchlist_analysis"
  | "comparison"
  | "risk_question"
  | "blocked_trade_question"
  | "trade_preview_request"
  | "trade_execution"
  | "general_out_of_scope";

/** Legacy quick-prompt mapping still used by heuristic switch. */
export type QuickPromptKind =
  | "analyze_watchlist"
  | "strongest"
  | "why_blocked"
  | "highest_confidence"
  | "market_news_risk"
  | "prepare_preview"
  | "small_account"
  | "compare"
  | "explain_symbol"
  | "watch_open"
  | "historical_data"
  | "trade_execution"
  | "app_scope"
  | "out_of_scope"
  | "generic";

export type HistoricalField = "high" | "low" | "open" | "close" | "all";

const SMALL_ACCOUNT_RE =
  /\b(small account|low[- ]priced|under \$?\d+|penny stock|fractional|notional|\$\d+\s+paper|dollar amount|cheaper stock|low priced|safest today)\b/i;

const PRICE_CAP_RE = /(?:under|below|less than)\s+\$?\s*(\d+)/i;

const TRADE_EXEC_RE =
  /\b(buy|sell|purchase|short|long|place\s+order|submit\s+order|execute(\s+trade)?|send\s+order)\b/i;

const TRADE_PREVIEW_RE =
  /prepare\s+(a\s+)?paper\s+trade|preview\s+(paper\s+)?trade|prepare\s+preview|paper\s+trade\s+preview/i;

const HISTORICAL_RE =
  /\b(yesterday|yesterdays|prior\s+day|last\s+session|previous\s+session|last\s+trading\s+day)\b/i;

const HISTORICAL_PRICE_RE =
  /\b(highest|high|lowest|low|open|close|closing|ohlc|volume)\b/i;

const WHAT_HAPPENED_RE =
  /what\s+happened\s+(yesterday|last\s+session)|how\s+did\s+.+\s+(do|trade)\s+yesterday/i;

const SCOPE_RE =
  /\b(what can (you|i) (ask|answer|do|help)|what do you (answer|do|help|cover)|do you answer|can you answer|do answer|any question|just market( related)?|market related|your (scope|capabilities|purpose)|help with|what should i ask)\b/i;

const OUT_OF_SCOPE_HINT_RE =
  /\b(weather|recipe|joke|poem|code my|write (an? )?(essay|email)|who is the president|sports score|movie|girlfriend|boyfriend|homework)\b/i;

const REFERS_TO_SELECTION_RE =
  /\b(this stock|this one|this ticker|that stock|it\b|its\b|what about this|how about this|selected)\b/i;

const FOLLOW_UP_SYMBOL_RE =
  /^(what about|how about|and|also)\s+([A-Za-z]{1,5})\??$/i;

export const APP_SCOPE_ANSWER =
  "I can help with your watchlist, stock analysis, yesterday high/low, market/news risk, strongest setup, trade blocks, paper trade previews, performance, and backtests. I do not place trades automatically.";

export const OUT_OF_SCOPE_ANSWER =
  "I’m focused on your trading dashboard, stocks, market data, news, risk, and paper trading. Ask me about your watchlist or market setup.";

export function isTradeRelatedIntent(intent: AiIntent): boolean {
  return (
    intent === "trade_preview_request" ||
    intent === "trade_execution" ||
    intent === "blocked_trade_question"
  );
}

export function parseHistoricalField(instruction: string): HistoricalField {
  const lower = instruction.toLowerCase();
  if (
    /\b(highest|high)\b/.test(lower) &&
    !/\b(low|lowest|open|close)\b/.test(lower)
  ) {
    return "high";
  }
  if (
    /\b(lowest|low)\b/.test(lower) &&
    !/\b(high|highest|open|close)\b/.test(lower)
  ) {
    return "low";
  }
  if (/\bopen(ing)?\b/.test(lower) && !/\b(high|low|close)\b/.test(lower)) {
    return "open";
  }
  if (
    /\b(close|closing)\b/.test(lower) &&
    !/\b(high|low|open)\b/.test(lower)
  ) {
    return "close";
  }
  return "all";
}

export function isHistoricalDataQuestion(instruction: string): boolean {
  const lower = instruction.toLowerCase().trim();
  if (TRADE_EXEC_RE.test(lower) || TRADE_PREVIEW_RE.test(lower)) return false;
  if (/highest\s+confidence|best\s+setup|strongest\s+stock/i.test(lower)) {
    return false;
  }
  if (WHAT_HAPPENED_RE.test(lower)) return true;
  if (HISTORICAL_RE.test(lower) && HISTORICAL_PRICE_RE.test(lower)) return true;
  if (
    /what\s+was\s+(the\s+)?(highest|high|lowest|low|open|close)/i.test(lower)
  ) {
    return true;
  }
  return false;
}

export function isAppScopeQuestion(instruction: string): boolean {
  return SCOPE_RE.test(instruction.toLowerCase().trim());
}

/**
 * Only use selectedSymbol when the question clearly needs it.
 */
export function shouldUseSelectedSymbol(
  instruction: string,
  intent: AiIntent,
): boolean {
  if (
    intent === "app_scope_question" ||
    intent === "general_out_of_scope" ||
    intent === "watchlist_analysis" ||
    intent === "market_summary" ||
    intent === "comparison" ||
    intent === "blocked_trade_question"
  ) {
    return false;
  }
  const lower = instruction.toLowerCase().trim();
  if (REFERS_TO_SELECTION_RE.test(lower)) return true;
  if (intent === "historical_price_question") {
    // Use selection only when no ticker is named in the text.
    return !/\b[A-Za-z]{1,5}\b/.test(
      lower.replace(
        /\b(what|was|the|highest|high|lowest|low|open|close|yesterday|yesterdays|prior|day|last|session|previous|trading|ohlc|volume|for|about)\b/gi,
        " ",
      ),
    );
  }
  if (intent === "stock_question" || intent === "risk_question") {
    return REFERS_TO_SELECTION_RE.test(lower);
  }
  return false;
}

export type ConversationHint = {
  lastInstruction?: string | null;
  lastIntentHint?: string | null;
};

/**
 * "what about NVDA?" after a historical question → continue historical for NVDA.
 */
export function isHistoricalFollowUp(
  instruction: string,
  conversation?: ConversationHint | null,
): boolean {
  const m = instruction.trim().match(FOLLOW_UP_SYMBOL_RE);
  if (!m) return false;
  const last = (conversation?.lastInstruction ?? "").toLowerCase();
  const hint = (conversation?.lastIntentHint ?? "").toLowerCase();
  if (hint.includes("historical") || isHistoricalDataQuestion(last)) {
    return true;
  }
  if (/high|low|open|close|yesterday|ohlc/i.test(last)) return true;
  return false;
}

export function classifyIntent(
  instruction: string,
  _selectedSymbol?: string | null,
  conversation?: ConversationHint | null,
): AiIntent {
  const lower = instruction.toLowerCase().trim();

  if (isAppScopeQuestion(instruction)) return "app_scope_question";

  if (SMALL_ACCOUNT_RE.test(lower) || PRICE_CAP_RE.test(lower)) {
    return "watchlist_analysis";
  }

  if (isHistoricalFollowUp(instruction, conversation)) {
    return "historical_price_question";
  }

  if (isHistoricalDataQuestion(instruction)) {
    return "historical_price_question";
  }

  if (TRADE_PREVIEW_RE.test(lower)) return "trade_preview_request";
  if (TRADE_EXEC_RE.test(lower)) return "trade_execution";

  if (/compare\b|vs\.?|versus/i.test(lower)) return "comparison";

  if (
    /why.*(all\s+)?(trades?\s+)?block|cannot trade|blocked|why\s+are\s+trades/i.test(
      lower,
    )
  ) {
    return "blocked_trade_question";
  }

  if (
    /\brisk\b/i.test(lower) &&
    /\b(explain|what|how|summarize|about)\b/i.test(lower)
  ) {
    return "risk_question";
  }

  if (
    /market\/news|news risk|summarize\s+(market|news)|market\s+and\s+news|summarize\s+news/i.test(
      lower,
    ) ||
    (/summarize/i.test(lower) && /market|news|risk/i.test(lower))
  ) {
    return "market_summary";
  }

  if (
    /strongest|highest confidence|best setup|looks strongest|find highest|analyze\s+(my\s+)?watchlist|watchlist\s+snapshot/i.test(
      lower,
    )
  ) {
    return "watchlist_analysis";
  }

  if (
    /why\s+is\s+[a-z]{1,5}|explain\s+[a-z]{1,5}|why\s+.+\s+hold|what about\s+[a-z]{1,5}|how about\s+[a-z]{1,5}/i.test(
      lower,
    )
  ) {
    return "stock_question";
  }

  if (OUT_OF_SCOPE_HINT_RE.test(lower)) return "general_out_of_scope";

  // Vague meta / capability questions already caught; remaining short non-trading
  // questions without market keywords are out of scope.
  const tradingCue =
    /\b(stock|stocks|watchlist|market|trade|trading|ticker|aapl|msft|nvda|amzn|googl|spy|qqq|paper|preview|backtest|performance|news|ohlc|buy|sell|hold|confidence|score)\b/i.test(
      lower,
    );
  if (!tradingCue && lower.split(/\s+/).length <= 12) {
    // e.g. "do answer any question or just market related"
    if (
      /question|answer|chat|talk|anything|any\s+thing|general|market related/i.test(
        lower,
      )
    ) {
      return "app_scope_question";
    }
    return "general_out_of_scope";
  }

  if (/analyze\b/i.test(lower)) return "watchlist_analysis";

  if (REFERS_TO_SELECTION_RE.test(lower)) return "stock_question";

  if (tradingCue) return "stock_question";

  return "general_out_of_scope";
}

export function intentToQuickPrompt(
  intent: AiIntent,
  instruction: string,
): QuickPromptKind {
  const lower = instruction.toLowerCase();
  switch (intent) {
    case "app_scope_question":
      return "app_scope";
    case "general_out_of_scope":
      return "out_of_scope";
    case "historical_price_question":
      return "historical_data";
    case "trade_preview_request":
      return "prepare_preview";
    case "trade_execution":
      return "trade_execution";
    case "comparison":
      return "compare";
    case "blocked_trade_question":
      return "why_blocked";
    case "market_summary":
    case "risk_question":
      return "market_news_risk";
    case "watchlist_analysis":
      if (
        SMALL_ACCOUNT_RE.test(lower) ||
        PRICE_CAP_RE.test(lower) ||
        /penny stock|fractional|notional|\$\d+/i.test(lower)
      ) {
        return "small_account";
      }
      if (/highest confidence|best setup|find highest/i.test(lower)) {
        return "highest_confidence";
      }
      if (/strongest/i.test(lower)) return "strongest";
      return "analyze_watchlist";
    case "stock_question":
      return "explain_symbol";
    default:
      return "generic";
  }
}
