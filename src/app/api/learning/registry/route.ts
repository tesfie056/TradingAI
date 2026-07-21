import { NextResponse } from "next/server";
import { learningApiJson } from "@/lib/learning/api-response";
import {
  getChampionStrategy,
  readStrategyRegistry,
} from "@/lib/strategy/registry";

export const dynamic = "force-dynamic";

/** GET — strategy registry (read-only for I-1; no disk writes). */
export async function GET() {
  const [registry, champion] = await Promise.all([
    readStrategyRegistry(),
    getChampionStrategy(),
  ]);

  const body = learningApiJson({
    champion: {
      strategyId: champion.strategyId,
      name: champion.name,
      version: champion.version,
      status: champion.status,
      createdAt: champion.createdAt,
      entryRules: champion.entryRules,
      exitRules: champion.exitRules,
      riskRequirements: champion.riskRequirements,
    },
    entries: registry.entries.map((e) => ({
      strategyId: e.strategyId,
      name: e.name,
      version: e.version,
      status: e.status,
      createdAt: e.createdAt,
      parentVersion: e.parentVersion,
      rejectionReason: e.rejectionReason,
    })),
  });

  return NextResponse.json(body);
}
