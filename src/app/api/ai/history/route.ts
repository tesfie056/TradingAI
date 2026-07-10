import { NextResponse } from "next/server";
import { readDecisionHistory } from "@/lib/ai/history";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const history = await readDecisionHistory(100);
    return NextResponse.json({
      paperOnly: true,
      orderExecutionEnabled: false,
      history,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read decision history";
    return NextResponse.json({ error: message, paperOnly: true }, { status: 500 });
  }
}
