/** U.S. equity market timezone — used for display and daily trade limits. */
export const MARKET_TIMEZONE = "America/New_York";

/** YYYY-MM-DD in Eastern time (en-CA gives ISO-like ordering). */
export function marketDayKey(iso: string = new Date().toISOString()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: MARKET_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function todayMarketDayKey(): string {
  return marketDayKey(new Date().toISOString());
}
