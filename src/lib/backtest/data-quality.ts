/**
 * Pre-backtest data-quality gate.
 */

import type {
  DataQualityIssue,
  HistoricalBar,
} from "@/lib/backtest/types";

export type DataQualityReport = {
  warnings: DataQualityIssue[];
  blocking: DataQualityIssue[];
  passed: boolean;
};

function issue(
  code: string,
  severity: "WARNING" | "BLOCKING",
  message: string,
  extra?: { symbol?: string; timestamp?: string },
): DataQualityIssue {
  return { code, severity, message, ...extra };
}

/** Overnight / weekend / holiday gap between RTH sessions (expected for 1Min/5Min bars). */
function isSessionBoundaryGap(prevMs: number, nextMs: number): boolean {
  const gapHours = (nextMs - prevMs) / 3_600_000;
  // ~17.5h overnight, Fri→Mon weekend, or long holiday weekends (~4 calendar days)
  return gapHours >= 6 && gapHours <= 110;
}

export function runDataQualityChecks(
  barsBySymbol: Record<string, HistoricalBar[]>,
): DataQualityReport {
  const warnings: DataQualityIssue[] = [];
  const blocking: DataQualityIssue[] = [];

  const symbols = Object.keys(barsBySymbol);
  const upper = symbols.map((s) => s.toUpperCase());
  if (new Set(upper).size !== upper.length) {
    blocking.push(
      issue("duplicate_symbols", "BLOCKING", "Duplicate symbols in universe"),
    );
  }

  const now = Date.now();

  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!bars || bars.length < 20) {
      blocking.push(
        issue("insufficient_bars", "BLOCKING", `Too few bars for ${symbol}`, {
          symbol,
        }),
      );
      continue;
    }

    const seen = new Set<string>();
    let prevMs = -Infinity;
    let intradayGapCount = 0;
    let sessionBoundaryCount = 0;
    let multiDayHoleCount = 0;

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i]!;
      const ms = Date.parse(b.timestamp);
      if (!Number.isFinite(ms)) {
        blocking.push(
          issue("bad_timestamp", "BLOCKING", "Invalid timestamp", {
            symbol,
            timestamp: b.timestamp,
          }),
        );
        continue;
      }
      if (ms > now + 60_000) {
        blocking.push(
          issue("future_timestamp", "BLOCKING", "Bar timestamp in the future", {
            symbol,
            timestamp: b.timestamp,
          }),
        );
      }
      if (seen.has(b.timestamp)) {
        blocking.push(
          issue("duplicate_timestamp", "BLOCKING", "Duplicate candle timestamp", {
            symbol,
            timestamp: b.timestamp,
          }),
        );
      }
      seen.add(b.timestamp);

      if (ms < prevMs) {
        blocking.push(
          issue("out_of_order", "BLOCKING", "Out-of-order candles", {
            symbol,
            timestamp: b.timestamp,
          }),
        );
      }
      if (prevMs > 0) {
        const gapMs = ms - prevMs;
        if (gapMs > 20 * 60_000 && gapMs < 6 * 3_600_000) {
          // >20m but <6h during what should be continuous session → missing candles
          intradayGapCount += 1;
        } else if (isSessionBoundaryGap(prevMs, ms)) {
          sessionBoundaryCount += 1;
        } else if (gapMs > 110 * 3_600_000) {
          multiDayHoleCount += 1;
        }
      }
      prevMs = ms;

      if (
        !(b.open > 0) ||
        !(b.high > 0) ||
        !(b.low > 0) ||
        !(b.close > 0) ||
        b.high < b.low ||
        b.high < Math.max(b.open, b.close) ||
        b.low > Math.min(b.open, b.close)
      ) {
        blocking.push(
          issue("invalid_ohlc", "BLOCKING", "Invalid OHLC values", {
            symbol,
            timestamp: b.timestamp,
          }),
        );
      }

      if (b.bid != null && b.ask != null) {
        if (b.bid <= 0 || b.ask <= 0 || b.ask < b.bid) {
          blocking.push(
            issue("impossible_spread", "BLOCKING", "Impossible bid/ask", {
              symbol,
              timestamp: b.timestamp,
            }),
          );
        }
        const mid = (b.bid + b.ask) / 2;
        if (mid > 0 && (b.ask - b.bid) / mid > 0.05) {
          warnings.push(
            issue("wide_spread", "WARNING", "Very wide quote spread", {
              symbol,
              timestamp: b.timestamp,
            }),
          );
        }
      }

      if (b.adjusted && b.source.includes("raw")) {
        warnings.push(
          issue(
            "adjust_inconsistency",
            "WARNING",
            "Adjusted flag inconsistent with raw source",
            { symbol },
          ),
        );
      }
    }

    if (sessionBoundaryCount > 0) {
      warnings.push(
        issue(
          "market_session_boundaries",
          "WARNING",
          `${sessionBoundaryCount} overnight/weekend session boundaries for ${symbol} (expected for RTH bars)`,
          { symbol },
        ),
      );
    }
    if (intradayGapCount > 3) {
      warnings.push(
        issue(
          "missing_candles",
          "WARNING",
          `${intradayGapCount} intraday gaps detected for ${symbol} (common on IEX during quiet periods)`,
          { symbol },
        ),
      );
    }
    // IEX often omits quiet 5Min buckets — do not block solely on gap count when
    // the series still has substantial bars. Block only with multi-day holes.
    if (intradayGapCount > 200 && bars.length < 500) {
      blocking.push(
        issue(
          "incomplete_sessions",
          "BLOCKING",
          `Too many missing intraday candles with sparse history for ${symbol}`,
          { symbol },
        ),
      );
    }
    if (multiDayHoleCount > 2) {
      blocking.push(
        issue(
          "stale_or_incomplete_range",
          "BLOCKING",
          `Multi-day holes in history for ${symbol}`,
          { symbol },
        ),
      );
    }
  }

  return {
    warnings,
    blocking,
    passed: blocking.length === 0,
  };
}
