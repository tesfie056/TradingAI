import { NextResponse } from "next/server";
import {
  getLatestQuotes,
  getRecentBars,
  lookupUsEquityAsset,
} from "@/lib/alpaca/client";
import { getSmallAccountConfig } from "@/lib/config";
import { assessDataQuality } from "@/lib/market/data-quality";
import { isBlockedNonStockSymbol } from "@/lib/stocks/universe";
import {
  estimateAvgDailyVolume,
  evaluateSmallAccountCandidate,
  filtersFromConfig,
} from "@/lib/stocks/small-account";

export const dynamic = "force-dynamic";

/**
 * Validate a single symbol against small-account filters.
 * Does not load the full universe. Never places orders.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = (searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (!raw) {
      return NextResponse.json(
        { ok: false, error: "symbol query param is required" },
        { status: 400 },
      );
    }
    if (isBlockedNonStockSymbol(raw)) {
      return NextResponse.json({
        ok: false,
        paperOnly: true,
        error: "Crypto and non-stock symbols are not allowed.",
        symbol: raw,
      });
    }

    const config = getSmallAccountConfig();
    const filters = filtersFromConfig(config);
    const maxPrice = Number(searchParams.get("maxPrice") ?? filters.maxPrice);
    const minVolume = Number(
      searchParams.get("minVolume") ?? filters.minAvgDailyVolume,
    );
    const maxSpread = Number(
      searchParams.get("maxSpread") ?? filters.maxSpreadPercent,
    );
    const avoidOtc = searchParams.get("avoidOtc") !== "false";
    const majorOnly = searchParams.get("majorOnly") !== "false";

    const asset = await lookupUsEquityAsset(raw);
    if (!asset) {
      return NextResponse.json({
        ok: false,
        paperOnly: true,
        error: `No Alpaca asset found for ${raw}.`,
        symbol: raw,
      });
    }

    const [quotes, dailyBars] = await Promise.all([
      getLatestQuotes([raw]),
      getRecentBars([raw], "1Day", 20),
    ]);
    const quote = quotes[0];
    const bars = dailyBars[raw] ?? [];
    const last = bars.at(-1)?.c ?? null;
    const bid = quote?.bid ?? null;
    const ask = quote?.ask ?? null;
    const price =
      last ??
      (bid != null && ask != null ? (bid + ask) / 2 : (ask ?? bid ?? null));
    const dq = assessDataQuality({
      isMarketOpen: true,
      quote,
      bars: [],
    });
    const avgDailyVolume = estimateAvgDailyVolume(bars);

    const result = evaluateSmallAccountCandidate({
      symbol: raw,
      price,
      spreadPercent: dq.spreadPercent,
      avgDailyVolume,
      exchange: asset.exchange,
      filters: {
        maxPrice,
        minAvgDailyVolume: minVolume,
        maxSpreadPercent: maxSpread,
        avoidOtc,
        majorExchangeOnly: majorOnly,
      },
    });

    return NextResponse.json({
      ok: true,
      paperOnly: true,
      liveTradingAllowed: false,
      smallAccountMode: config.enabled,
      candidate: result,
      asset: {
        symbol: asset.symbol,
        name: asset.name,
        exchange: asset.exchange,
      },
      message: result.eligible
        ? `${raw} passed small-account candidate filters.`
        : `${raw} did not pass small-account filters.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        paperOnly: true,
        error: err instanceof Error ? err.message : "Candidate check failed",
      },
      { status: 500 },
    );
  }
}
