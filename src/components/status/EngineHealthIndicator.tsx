"use client";

import { StatusLight } from "@/components/status/StatusLight";
import {
  mapEngineHealth,
  type RuntimeStatusInput,
} from "@/lib/client/runtime-status-mapper";

export function EngineHealthIndicator({ input }: { input: RuntimeStatusInput }) {
  const mapped = mapEngineHealth(input);
  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <StatusLight
        tone={mapped.tone}
        kind={
          mapped.critical ? "alert" : mapped.tone === "warn" ? "ring" : "solid"
        }
      />
      <span className="text-zinc-100">
        Engine {mapped.state.toLowerCase()}
      </span>
      <span className="text-xs text-[var(--muted)]">{mapped.detail}</span>
    </div>
  );
}
