import { NextResponse } from "next/server";
import { monitorSafetyFlags } from "@/lib/monitor/safety";
import {
  buildAndPersistSessionReport,
  readLatestSessionReport,
} from "@/lib/trading/session-report";

export const dynamic = "force-dynamic";

/**
 * GET — paper soak session report (builds/refreshes on demand).
 * Query ?cached=1 to return last persisted report only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const cached = url.searchParams.get("cached") === "1";
  const report = cached
    ? await readLatestSessionReport()
    : await buildAndPersistSessionReport();

  if (!report) {
    return NextResponse.json(
      {
        ok: false,
        error: "No session report yet",
        ...monitorSafetyFlags(),
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    report,
    ...monitorSafetyFlags(),
  });
}
