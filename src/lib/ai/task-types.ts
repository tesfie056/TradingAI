/**
 * Public AI task types — safe for client imports.
 */

import type {
  AiCommandResponse,
  AiCommandSuggestedAction,
} from "@/lib/ai/command-types";

export type AiTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AiTaskRecord = {
  taskId: string;
  question: string;
  selectedSymbol: string | null;
  status: AiTaskStatus;
  answer: string | null;
  relatedSymbols: string[];
  suggestedAction: AiCommandSuggestedAction | null;
  safetyWarnings: string[];
  tradePreviewAllowed: boolean;
  previewHint: AiCommandResponse["previewHint"];
  provider: "ollama" | "heuristic" | null;
  usedFallback: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  paperOnly: true;
  liveTradingAllowed: false;
  automaticTradingAllowed: false;
  canSubmitOrders: false;
};
