/**
 * Client persistence for AI Assistant popup geometry + chat turns + chrome indicator.
 */

export type AiPopupGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
};

export type AiChatTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  taskId?: string;
  status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  relatedSymbols?: string[];
  safetyWarnings?: string[];
  selectedSymbol?: string | null;
  timestamp: string;
  error?: string | null;
};

export type AiChromeIndicator = {
  thinking: boolean;
  resultsReady: number;
};

const GEO_KEY = "tradingai.ai-popup-geometry.v1";
const CHAT_KEY = "tradingai.ai-popup-chat.v1";
const ACTIVE_KEY = "tradingai.ai-popup-active-task.v1";
const OPEN_KEY = "tradingai.ai-popup-open.v1";
const INDICATOR_KEY = "tradingai.ai-popup-indicator.v1";

export const DEFAULT_POPUP_GEOMETRY: AiPopupGeometry = {
  x: 80,
  y: 80,
  width: 420,
  height: 560,
  minimized: false,
  maximized: false,
};

export const DEFAULT_AI_INDICATOR: AiChromeIndicator = {
  thinking: false,
  resultsReady: 0,
};

export function loadPopupGeometry(): AiPopupGeometry {
  if (typeof window === "undefined") return { ...DEFAULT_POPUP_GEOMETRY };
  try {
    const raw = window.localStorage.getItem(GEO_KEY);
    if (!raw) return { ...DEFAULT_POPUP_GEOMETRY };
    const parsed = JSON.parse(raw) as Partial<AiPopupGeometry>;
    return {
      ...DEFAULT_POPUP_GEOMETRY,
      ...parsed,
      width: Math.max(320, Number(parsed.width) || DEFAULT_POPUP_GEOMETRY.width),
      height: Math.max(360, Number(parsed.height) || DEFAULT_POPUP_GEOMETRY.height),
    };
  } catch {
    return { ...DEFAULT_POPUP_GEOMETRY };
  }
}

export function savePopupGeometry(geo: AiPopupGeometry): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GEO_KEY, JSON.stringify(geo));
}

export function loadPopupChat(): AiChatTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AiChatTurn[];
    return Array.isArray(parsed) ? parsed.slice(-80) : [];
  } catch {
    return [];
  }
}

export function savePopupChat(turns: AiChatTurn[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHAT_KEY, JSON.stringify(turns.slice(-80)));
}

export function loadActiveTaskId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_KEY);
}

export function saveActiveTaskId(taskId: string | null): void {
  if (typeof window === "undefined") return;
  if (!taskId) window.localStorage.removeItem(ACTIVE_KEY);
  else window.localStorage.setItem(ACTIVE_KEY, taskId);
}

/** Persist open across soft navigations / remounts (session). */
export function loadAiPopupOpen(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(OPEN_KEY) === "1";
}

export function saveAiPopupOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  if (open) window.sessionStorage.setItem(OPEN_KEY, "1");
  else window.sessionStorage.removeItem(OPEN_KEY);
}

export function loadAiIndicator(): AiChromeIndicator {
  if (typeof window === "undefined") return { ...DEFAULT_AI_INDICATOR };
  try {
    const raw = window.sessionStorage.getItem(INDICATOR_KEY);
    if (!raw) return { ...DEFAULT_AI_INDICATOR };
    const parsed = JSON.parse(raw) as Partial<AiChromeIndicator>;
    return {
      thinking: Boolean(parsed.thinking),
      resultsReady: Math.max(0, Number(parsed.resultsReady) || 0),
    };
  } catch {
    return { ...DEFAULT_AI_INDICATOR };
  }
}

export function saveAiIndicator(indicator: AiChromeIndicator): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(INDICATOR_KEY, JSON.stringify(indicator));
}

export function formatTaskStatusLabel(
  status: AiChatTurn["status"] | "idle" | null | undefined,
  busy = false,
): string {
  if (busy) return "Thinking";
  switch (status) {
    case "pending":
    case "running":
      return "Thinking";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Canceled";
    default:
      return "Idle";
  }
}
