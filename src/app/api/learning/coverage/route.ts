import { NextResponse } from "next/server";
import { learningApiJson } from "@/lib/learning/api-response";
import { buildCoverageInventory } from "@/lib/backtest/coverage";

export const dynamic = "force-dynamic";

/** GET — read-only market data coverage inventory. */
export async function GET() {
  const rows = await buildCoverageInventory();
  const ready = rows.filter((r) => r.status === "READY").length;
  return NextResponse.json(
    learningApiJson({
      rows,
      summary: {
        total: rows.length,
        ready,
        partial: rows.filter((r) => r.status === "PARTIAL").length,
        blocked: rows.filter((r) => r.status === "BLOCKED").length,
        stale: rows.filter((r) => r.status === "STALE").length,
      },
      note: "Cached under data/historical/ (gitignored). Run npm run learning:download-history to refresh.",
    }),
  );
}
