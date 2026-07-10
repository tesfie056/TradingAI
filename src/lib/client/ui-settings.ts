/**
 * Client-only UI preferences (localStorage).
 * Server safety gates still use env — this never enables live trading.
 */

export type UiViewMode = "simple" | "advanced";

export type UiSettings = {
  watchlistDraft: string;
  maxTradeAmount: number;
  maxDailyPaperTrades: number;
  minConfidence: number;
  maxSpreadPct: number;
  /** Display preference only — real execution still requires env flag. */
  preferExecutionEnabled: boolean;
  /** Default paper qty for Control Room prepare/preview. */
  defaultQuantity: number;
  /** Compact score badges vs fuller labels. */
  compactScores: boolean;
  /** Show news column when space allows. */
  showNewsColumn: boolean;
  /** Show trend/volume columns on wider screens. */
  showTrendVolume: boolean;
  /** Simple = guided essentials; Advanced = full score detail. */
  viewMode: UiViewMode;
};

export const DEFAULT_UI_SETTINGS: UiSettings = {
  watchlistDraft: "AAPL,MSFT,GOOGL,AMZN,NVDA",
  maxTradeAmount: 500,
  maxDailyPaperTrades: 5,
  minConfidence: 0.45,
  maxSpreadPct: 0.01,
  preferExecutionEnabled: false,
  defaultQuantity: 1,
  compactScores: true,
  showNewsColumn: true,
  showTrendVolume: true,
  viewMode: "simple",
};

const KEY = "tradingai.ui-settings.v1";
const AI_CMD_KEY = "tradingai.ai-command-history.v1";

const uiSettingsListeners = new Set<() => void>();

/** Subscribe to local UI settings changes (for useSyncExternalStore). */
export function subscribeUiSettings(onStoreChange: () => void): () => void {
  uiSettingsListeners.add(onStoreChange);
  return () => {
    uiSettingsListeners.delete(onStoreChange);
  };
}

function emitUiSettingsChange(): void {
  for (const listener of uiSettingsListeners) listener();
}

export function loadUiSettings(): UiSettings {
  if (typeof window === "undefined") return { ...DEFAULT_UI_SETTINGS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_UI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      ...DEFAULT_UI_SETTINGS,
      ...parsed,
      preferExecutionEnabled: false,
      defaultQuantity: Math.max(
        1,
        Math.floor(Number(parsed.defaultQuantity) || 1),
      ),
      viewMode: parsed.viewMode === "advanced" ? "advanced" : "simple",
    };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

export function saveUiSettings(settings: UiSettings): void {
  if (typeof window === "undefined") return;
  const next: UiSettings = {
    ...DEFAULT_UI_SETTINGS,
    ...settings,
    // Never persist a preference that implies live trading is available.
    preferExecutionEnabled: false,
    defaultQuantity: Math.max(1, Math.floor(Number(settings.defaultQuantity) || 1)),
    viewMode: settings.viewMode === "advanced" ? "advanced" : "simple",
  };
  window.localStorage.setItem(KEY, JSON.stringify(next));
  emitUiSettingsChange();
}

export function parseWatchlistDraft(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const symbol = part.trim().toUpperCase();
    if (!symbol) continue;
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

export function getLocalWatchlistSymbols(): string[] {
  return parseWatchlistDraft(loadUiSettings().watchlistDraft);
}

/** Add a U.S. stock symbol to local watchlist preferences (browser only). */
export function addLocalWatchlistSymbol(symbol: string): string[] {
  const nextSym = symbol.trim().toUpperCase();
  const current = getLocalWatchlistSymbols();
  if (!current.includes(nextSym)) {
    current.push(nextSym);
  }
  const ui = loadUiSettings();
  saveUiSettings({ ...ui, watchlistDraft: current.join(",") });
  return current;
}

export type StoredAiCommand = {
  id: string;
  instruction: string;
  answer: string;
  relatedSymbols: string[];
  suggestedAction: string;
  timestamp: string;
  provider: string;
};

export function loadAiCommandHistory(): StoredAiCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(AI_CMD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredAiCommand[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function saveAiCommandHistory(entries: StoredAiCommand[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    AI_CMD_KEY,
    JSON.stringify(entries.slice(0, 40)),
  );
}

export function clearAiCommandHistory(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AI_CMD_KEY);
}

export function pushAiCommandHistory(entry: StoredAiCommand): StoredAiCommand[] {
  const next = [entry, ...loadAiCommandHistory()].slice(0, 40);
  saveAiCommandHistory(next);
  return next;
}
