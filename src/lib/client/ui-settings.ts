import { filterUsStockSymbols } from "@/lib/stocks/universe";
import type { OrderMode } from "@/lib/config";

/**
 * Client-only UI preferences (localStorage).
 * Server safety gates still use env — this never enables live trading.
 */

export type UiViewMode = "simple" | "advanced";
export type UiCardDensity = "compact" | "comfortable";
export type UiMaxRiskAllowed = "low" | "medium";
export type UiOrderMode = OrderMode;

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
  /** Shares vs dollar amount for paper orders. */
  orderMode: UiOrderMode;
  /** Default dollar amount when orderMode is notional. */
  defaultNotional: number;
  /** Small-account watchlist filter: max share price (UI). */
  smallAccountMaxPrice: number;
  /** Small-account watchlist filter: min avg daily volume (UI). */
  smallAccountMinVolume: number;
  /** Small-account watchlist filter: max spread % (UI). */
  smallAccountMaxSpread: number;
  /** Avoid OTC when validating candidates. */
  smallAccountAvoidOtc: boolean;
  /** Major exchange only for candidate validation. */
  smallAccountMajorOnly: boolean;
  /** Compact score badges vs fuller labels. */
  compactScores: boolean;
  /** Compact cards vs comfortable spacing. */
  cardDensity: UiCardDensity;
  /** Show detailed score breakdowns in watchlist/trade UI. */
  showScoreDetails: boolean;
  /** Show detailed blocked-reason copy. */
  showBlockedReasonDetails: boolean;
  /** UI preference: only surface Low/Medium risk as “allowed” for preview hints. */
  maxRiskAllowed: UiMaxRiskAllowed;
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
  orderMode: "notional",
  defaultNotional: 10,
  smallAccountMaxPrice: 50,
  smallAccountMinVolume: 1_000_000,
  smallAccountMaxSpread: 0.5,
  smallAccountAvoidOtc: true,
  smallAccountMajorOnly: true,
  compactScores: true,
  cardDensity: "comfortable",
  showScoreDetails: true,
  showBlockedReasonDetails: true,
  maxRiskAllowed: "medium",
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
  cachedWatchlistDraft = null;
  cachedWatchlistSymbols = EMPTY_WATCHLIST;
  cachedDefaultQuantity = null;
  cachedOrderMode = null;
  cachedDefaultNotional = null;
  cachedViewMode = null;
  for (const listener of uiSettingsListeners) listener();
}

/** Stable empty snapshot for SSR / useSyncExternalStore getServerSnapshot. */
const EMPTY_WATCHLIST: string[] = [];
const SERVER_DEFAULT_QTY = 1;

let cachedWatchlistDraft: string | null = null;
let cachedWatchlistSymbols: string[] = EMPTY_WATCHLIST;
let cachedDefaultQuantity: number | null = null;
let cachedOrderMode: UiOrderMode | null = null;
let cachedDefaultNotional: number | null = null;
let cachedViewMode: UiViewMode | null = null;

const SERVER_VIEW_MODE: UiViewMode = "simple";

export function getLocalWatchlistSymbolsSnapshot(): string[] {
  const draft = loadUiSettings().watchlistDraft;
  if (cachedWatchlistDraft === draft) return cachedWatchlistSymbols;
  cachedWatchlistDraft = draft;
  cachedWatchlistSymbols = parseWatchlistDraft(draft);
  return cachedWatchlistSymbols;
}

export function getLocalWatchlistSymbolsServerSnapshot(): string[] {
  return EMPTY_WATCHLIST;
}

export function getDefaultQuantitySnapshot(): number {
  const qty = loadUiSettings().defaultQuantity;
  if (cachedDefaultQuantity === qty) return cachedDefaultQuantity;
  cachedDefaultQuantity = qty;
  return qty;
}

export function getDefaultQuantityServerSnapshot(): number {
  return SERVER_DEFAULT_QTY;
}

export function getOrderModeSnapshot(): UiOrderMode {
  const mode = loadUiSettings().orderMode;
  if (cachedOrderMode === mode) return cachedOrderMode;
  cachedOrderMode = mode === "quantity" ? "quantity" : "notional";
  return cachedOrderMode;
}

export function getOrderModeServerSnapshot(): UiOrderMode {
  return "notional";
}

export function getDefaultNotionalSnapshot(): number {
  const n = loadUiSettings().defaultNotional;
  if (cachedDefaultNotional === n) return cachedDefaultNotional;
  cachedDefaultNotional = Math.max(1, Number(n) || 10);
  return cachedDefaultNotional;
}

export function getDefaultNotionalServerSnapshot(): number {
  return 10;
}

export function getViewModeSnapshot(): UiViewMode {
  const mode = loadUiSettings().viewMode;
  const normalized = mode === "advanced" ? "advanced" : "simple";
  if (cachedViewMode === normalized) return cachedViewMode;
  cachedViewMode = normalized;
  return normalized;
}

export function getViewModeServerSnapshot(): UiViewMode {
  return SERVER_VIEW_MODE;
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
      orderMode: parsed.orderMode === "quantity" ? "quantity" : "notional",
      defaultNotional: Math.max(1, Number(parsed.defaultNotional) || 10),
      smallAccountMaxPrice: Math.max(
        1,
        Number(parsed.smallAccountMaxPrice) || 50,
      ),
      smallAccountMinVolume: Math.max(
        0,
        Math.floor(Number(parsed.smallAccountMinVolume) || 1_000_000),
      ),
      smallAccountMaxSpread: Math.max(
        0.01,
        Number(parsed.smallAccountMaxSpread) || 0.5,
      ),
      smallAccountAvoidOtc: parsed.smallAccountAvoidOtc !== false,
      smallAccountMajorOnly: parsed.smallAccountMajorOnly !== false,
      viewMode: parsed.viewMode === "advanced" ? "advanced" : "simple",
      cardDensity:
        parsed.cardDensity === "compact" ? "compact" : "comfortable",
      showScoreDetails: parsed.showScoreDetails !== false,
      showBlockedReasonDetails: parsed.showBlockedReasonDetails !== false,
      maxRiskAllowed: parsed.maxRiskAllowed === "low" ? "low" : "medium",
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
    orderMode: settings.orderMode === "quantity" ? "quantity" : "notional",
    defaultNotional: Math.max(1, Number(settings.defaultNotional) || 10),
    smallAccountMaxPrice: Math.max(1, Number(settings.smallAccountMaxPrice) || 50),
    smallAccountMinVolume: Math.max(
      0,
      Math.floor(Number(settings.smallAccountMinVolume) || 1_000_000),
    ),
    smallAccountMaxSpread: Math.max(
      0.01,
      Number(settings.smallAccountMaxSpread) || 0.5,
    ),
    smallAccountAvoidOtc: settings.smallAccountAvoidOtc !== false,
    smallAccountMajorOnly: settings.smallAccountMajorOnly !== false,
    viewMode: settings.viewMode === "advanced" ? "advanced" : "simple",
    cardDensity: settings.cardDensity === "compact" ? "compact" : "comfortable",
    maxRiskAllowed: settings.maxRiskAllowed === "low" ? "low" : "medium",
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
  return filterUsStockSymbols(out);
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

/** Remove a symbol from local watchlist preferences (browser only). */
export function removeLocalWatchlistSymbol(symbol: string): string[] {
  const nextSym = symbol.trim().toUpperCase();
  const current = getLocalWatchlistSymbols().filter((s) => s !== nextSym);
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
