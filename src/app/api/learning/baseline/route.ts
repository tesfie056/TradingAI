import { NextResponse } from "next/server";
import {
  learningApiJson,
  lockNestedSafety,
} from "@/lib/learning/api-response";
import { buildBaselineReport } from "@/lib/learning/baseline-report";

export const dynamic = "force-dynamic";

/** GET — Paper Intelligence v1 baseline report (read-only). */
export async function GET() {
  const baseline = lockNestedSafety(await buildBaselineReport());
  return NextResponse.json(learningApiJson({ baseline }));
}
