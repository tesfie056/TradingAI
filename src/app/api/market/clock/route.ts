import { NextResponse } from "next/server";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import {
  getFreshBrokerClock,
  marketStatusLabel,
} from "@/lib/market/broker-clock";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await getFreshBrokerClock({ force: true });
    if (snap.status === "unavailable") {
      return NextResponse.json(
        {
          paperOnly: true,
          marketSessionStatus: "unavailable",
          marketStatusLabel: marketStatusLabel("unavailable"),
          error: snap.error ?? "Broker clock request failed",
          clock: null,
          fetchedAt: snap.fetchedAt,
        },
        { status: 503 },
      );
    }
    return NextResponse.json({
      paperOnly: true,
      marketSessionStatus: snap.status,
      marketStatusLabel: marketStatusLabel(snap.status),
      fetchedAt: snap.fetchedAt,
      clock: {
        paperOnly: true as const,
        timestamp: snap.timestamp,
        isOpen: snap.isOpen === true,
        nextOpen: snap.nextOpen,
        nextClose: snap.nextClose,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load market clock";
    const status = error instanceof PaperTradingSafetyError ? 403 : 503;
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        marketSessionStatus: "unavailable",
        marketStatusLabel: marketStatusLabel("unavailable"),
        clock: null,
      },
      { status },
    );
  }
}
