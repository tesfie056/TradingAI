import { NextResponse } from "next/server";
import { runAiCommand } from "@/lib/ai/command";
import type { AiCommandRequest } from "@/lib/ai/command-types";

export const dynamic = "force-dynamic";

/**
 * AI Command Center endpoint.
 * Analyzes / explains / may allow preparing a paper preview.
 * NEVER submits orders. NEVER enables live or automatic trading.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AiCommandRequest;
    if (!body?.userInstruction || typeof body.userInstruction !== "string") {
      return NextResponse.json(
        { error: "userInstruction is required" },
        { status: 400 },
      );
    }

    const result = await runAiCommand({
      userInstruction: body.userInstruction,
      selectedSymbol: body.selectedSymbol ?? null,
      conversation: body.conversation ?? null,
      context: body.context ?? {},
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "AI command failed",
        paperOnly: true,
        liveTradingAllowed: false,
        automaticTradingAllowed: false,
      },
      { status: 500 },
    );
  }
}
