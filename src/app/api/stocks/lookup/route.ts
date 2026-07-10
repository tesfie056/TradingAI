import { NextResponse } from "next/server";
import { lookupUsEquityAsset } from "@/lib/alpaca/client";
import { isBlockedNonStockSymbol } from "@/lib/stocks/universe";

export const dynamic = "force-dynamic";

/**
 * Validate a single U.S. stock symbol via Alpaca paper assets API.
 * Does not return the full universe. Never places orders.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = (searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (!raw) {
      return NextResponse.json(
        { error: "symbol query param is required", ok: false },
        { status: 400 },
      );
    }
    if (isBlockedNonStockSymbol(raw)) {
      return NextResponse.json({
        ok: false,
        error: "Crypto and non-stock symbols are not allowed.",
        symbol: raw,
      });
    }

    const asset = await lookupUsEquityAsset(raw);
    if (!asset) {
      return NextResponse.json({
        ok: false,
        error: `No Alpaca asset found for ${raw}.`,
        symbol: raw,
      });
    }

    const isUsEquity =
      asset.class === "us_equity" || asset.class === "us_equity".toLowerCase();
    if (!isUsEquity) {
      return NextResponse.json({
        ok: false,
        error: `${asset.symbol} is not a U.S. equity (class: ${asset.class}). Stocks only.`,
        symbol: asset.symbol,
        asset,
      });
    }
    if (asset.status !== "active" || !asset.tradable) {
      return NextResponse.json({
        ok: false,
        error: `${asset.symbol} is not an active tradable U.S. stock on Alpaca paper.`,
        symbol: asset.symbol,
        asset,
      });
    }

    return NextResponse.json({
      ok: true,
      paperOnly: true,
      symbol: asset.symbol,
      name: asset.name,
      exchange: asset.exchange,
      asset,
      message: `${asset.symbol} is a valid U.S. stock for your local watchlist preferences.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Symbol lookup failed",
        paperOnly: true,
      },
      { status: 500 },
    );
  }
}
