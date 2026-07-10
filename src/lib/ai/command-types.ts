/**
 * AI Command Center types.
 * Commands analyze / explain / compare / prepare preview only — never submit orders.
 */

export type AiCommandSuggestedAction =
  | "analyze"
  | "explain"
  | "compare"
  | "preview_only"
  | "none";

export type AiCommandDecisionContext = {
  symbol: string;
  action: string;
  confidence: number;
  riskLevel?: string;
  finalScore?: number;
  technicalScore?: number;
  marketScore?: number;
  newsScore?: number;
  riskScore?: number;
  tradeBlockReasons?: string[];
  readyForManualPaperTrade?: boolean;
  summary?: string;
  technicalReason?: string;
  newsReason?: string;
  marketReason?: string;
  riskReason?: string;
};

export type AiCommandRequest = {
  userInstruction: string;
  selectedSymbol?: string | null;
  /** Optional prior turn — used for follow-ups like “what about NVDA?” */
  conversation?: {
    lastInstruction?: string | null;
    lastIntentHint?: string | null;
  } | null;
  context?: {
    watchlist?: string[];
    marketOpen?: boolean | null;
    orderExecutionEnabled?: boolean;
    account?: {
      equity?: string | null;
      cash?: string | null;
      buyingPower?: string | null;
      currency?: string;
    } | null;
    decisions?: AiCommandDecisionContext[];
    newsBySymbol?: Record<
      string,
      {
        overallSentiment?: string | null;
        explanation?: string;
        headlines?: string[];
      }
    >;
    marketCondition?: {
      label?: string;
      explanation?: string;
      marketScore?: number;
    } | null;
  };
};

export type AiCommandResponse = {
  paperOnly: true;
  liveTradingAllowed: false;
  automaticTradingAllowed: false;
  orderExecutionEnabled: boolean;
  answer: string;
  relatedSymbols: string[];
  suggestedAction: AiCommandSuggestedAction;
  safetyWarnings: string[];
  tradePreviewAllowed: boolean;
  previewHint: {
    symbol: string;
    side: "buy" | "sell";
  } | null;
  provider: "ollama" | "heuristic";
  usedFallback: boolean;
  timestamp: string;
};

export type AiCommandHistoryEntry = {
  id: string;
  instruction: string;
  answer: string;
  relatedSymbols: string[];
  suggestedAction: AiCommandSuggestedAction;
  timestamp: string;
  provider: "ollama" | "heuristic";
};
