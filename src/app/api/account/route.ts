import { NextResponse } from "next/server";
import { getAccount } from "@/lib/alpaca/client";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { PAPER_TRADING_BASE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await getAccount();
    return NextResponse.json({
      paperOnly: true,
      endpoint: PAPER_TRADING_BASE_URL,
      account: {
        id: account.id,
        accountNumber: account.account_number,
        status: account.status,
        currency: account.currency,
        cash: account.cash,
        equity: account.equity,
        portfolioValue: account.portfolio_value,
        buyingPower: account.buying_power,
        lastEquity: account.last_equity,
        tradingBlocked: account.trading_blocked,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load account";
    const status = error instanceof PaperTradingSafetyError ? 403 : 500;
    return NextResponse.json({ error: message, paperOnly: true }, { status });
  }
}
