/**
 * Regular-session timing helpers for Version 1 strategy (U.S. equities, Eastern).
 */

import { MARKET_TIMEZONE } from "@/lib/market/time";

function etParts(nowMs: number): {
  hour: number;
  minute: number;
  weekday: string;
} {
  const d = new Date(nowMs);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    weekday: "short",
  }).format(d);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: MARKET_TIMEZONE,
      hour: "numeric",
      hour12: false,
    }).format(d),
  );
  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: MARKET_TIMEZONE,
      minute: "numeric",
    }).format(d),
  );
  return { hour: hour === 24 ? 0 : hour, minute, weekday };
}

/** Minutes since 09:30 America/New_York (null if weekend or before open). */
export function minutesSinceRegularOpen(nowMs: number = Date.now()): number | null {
  const { hour, minute, weekday } = etParts(nowMs);
  if (weekday === "Sat" || weekday === "Sun") return null;
  const mins = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (mins < open || mins > close) return null;
  return mins - open;
}

/** Minutes until 16:00 America/New_York (null if closed). */
export function minutesUntilRegularClose(nowMs: number = Date.now()): number | null {
  const { hour, minute, weekday } = etParts(nowMs);
  if (weekday === "Sat" || weekday === "Sun") return null;
  const mins = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (mins < open || mins > close) return null;
  return close - mins;
}
