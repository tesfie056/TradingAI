/**
 * Client-only UI preferences (localStorage).
 * Server safety gates still use env — this never enables live trading.
 */

export type UiSettings = {
  watchlistDraft: string;
  maxTradeAmount: number;
  maxDailyPaperTrades: number;
  minConfidence: number;
  maxSpreadPct: number;
  /** Display preference only — real execution still requires env flag. */
  preferExecutionEnabled: boolean;
};

export const DEFAULT_UI_SETTINGS: UiSettings = {
  watchlistDraft: "AAPL,MSFT,GOOGL,AMZN,NVDA",
  maxTradeAmount: 500,
  maxDailyPaperTrades: 5,
  minConfidence: 0.45,
  maxSpreadPct: 0.01,
  preferExecutionEnabled: false,
};

const KEY = "tradingai.ui-settings.v1";

export function loadUiSettings(): UiSettings {
  if (typeof window === "undefined") return { ...DEFAULT_UI_SETTINGS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_UI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      ...DEFAULT_UI_SETTINGS,
      ...parsed,
      preferExecutionEnabled: false, // never persist as a way to auto-enable
    };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

export function saveUiSettings(settings: UiSettings): void {
  if (typeof window === "undefined") return;
  const safe: UiSettings = {
    ...settings,
    preferExecutionEnabled: false,
  };
  window.localStorage.setItem(KEY, JSON.stringify(safe));
}
