import { NextResponse } from "next/server";
import { learningApiJson } from "@/lib/learning/api-response";
import {
  createJob,
  readJob,
  cancelJob,
  runJobInBackground,
} from "@/lib/jobs/background";
import { listBacktestRuns, readBacktestRun } from "@/lib/backtest/storage";
import { buildWeaknessReport } from "@/lib/backtest/weakness";
import { listDqSummaries } from "@/lib/backtest/dq-summary";
import { createTypedExperiment } from "@/lib/backtest/experiments";
import { compareFingerprints } from "@/lib/backtest/fingerprint";

export const dynamic = "force-dynamic";

/** GET — poll job status (read-only). */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "id required", paperOnly: true, liveTradingAllowed: false },
      { status: 400 },
    );
  }
  const job = await readJob(id);
  if (!job) {
    return NextResponse.json(
      { error: "Job not found", paperOnly: true, liveTradingAllowed: false },
      { status: 404 },
    );
  }
  return NextResponse.json(learningApiJson({ job }));
}

/**
 * POST — enqueue analysis job. Never via GET.
 * Body: { type: "weakness" | "dq_summaries" | "create_experiment" | "reconcile", kind? }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      type?: string;
      kind?: "cost_aware_filter" | "confidence_threshold" | "time_of_day_filter";
      runId?: string;
      cancelId?: string;
    };

    if (body.cancelId) {
      const job = await cancelJob(body.cancelId);
      return NextResponse.json(learningApiJson({ job }));
    }

    const type = body.type ?? "weakness";
    const job = await createJob(type);

    runJobInBackground(job.id, async ({ progress, isCancelled }) => {
      if (type === "dq_summaries") {
        await progress(10, "Scanning cache summaries…");
        if (await isCancelled()) return null;
        const rows = await listDqSummaries();
        await progress(90, "Summaries ready");
        return { rows };
      }
      if (type === "create_experiment") {
        await progress(20, "Creating typed experiment…");
        if (!body.kind) throw new Error("kind required");
        const created = await createTypedExperiment(body.kind);
        if (!created.ok) throw new Error(created.error);
        await progress(90, "Experiment locked");
        return { experiment: created.experiment };
      }
      if (type === "reconcile") {
        await progress(15, "Loading recent runs…");
        const index = await listBacktestRuns(10);
        const runs = [];
        for (const m of index) {
          const r = await readBacktestRun(m.id);
          if (r) runs.push(r);
        }
        await progress(60, "Comparing fingerprints…");
        const pairs = [];
        for (let i = 0; i < runs.length; i++) {
          for (let j = i + 1; j < runs.length; j++) {
            const a = runs[i]!;
            const b = runs[j]!;
            pairs.push({
              a: a.id,
              b: b.id,
              compare: compareFingerprints(a.runFingerprint, b.runFingerprint),
              aTrades: a.metrics.totalTrades,
              bTrades: b.metrics.totalTrades,
              aPf: a.metrics.profitFactor,
              bPf: b.metrics.profitFactor,
            });
          }
        }
        return {
          causeHint:
            "I-3 stress base PF differed from baseline because stress used thinned bars (every 3rd). Comparable stress must use the same evalStep and full dataset.",
          pairs,
        };
      }
      // weakness default
      await progress(10, "Loading run…");
      const index = await listBacktestRuns(30);
      let run = body.runId ? await readBacktestRun(body.runId) : null;
      if (!run) {
        for (const m of index) {
          const r = await readBacktestRun(m.id);
          if (r && r.realDataOnly && !r.syntheticDataUsed) {
            run = r;
            break;
          }
        }
      }
      if (!run) throw new Error("No real backtest run found for weakness report");
      await progress(50, "Analyzing weaknesses…");
      if (await isCancelled()) return null;
      const report = buildWeaknessReport(run);
      await progress(90, "Report ready");
      return { report };
    });

    return NextResponse.json(
      learningApiJson({
        jobId: job.id,
        status: job.status,
        note: "Poll GET /api/learning/jobs?id=… for progress",
      }),
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Job enqueue failed",
        paperOnly: true,
        liveTradingAllowed: false,
      },
      { status: 500 },
    );
  }
}
