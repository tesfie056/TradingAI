"use client";

import type { AutoTradeEngineState } from "@/lib/auto-trade/runtime-settings/types";

export function SafetyStrip({
  orderExecutionEnabled,
  autoTradingEnabled,
  engineState,
  compact = false,
}: {
  orderExecutionEnabled: boolean;
  autoTradingEnabled?: boolean;
  engineState?: AutoTradeEngineState | string | null;
  compact?: boolean;
}) {
  const autoLabel = autoTradingEnabled
    ? "Auto trading ON"
    : "Auto trading OFF";
  const stateLabel = engineState
    ? String(engineState).replace(/_/g, " ")
    : null;

  if (compact) {
    return (
      <p className="text-sm leading-relaxed text-amber-100/90">
        <span className="font-semibold">Paper only</span>
        {" · "}
        Execution {orderExecutionEnabled ? "ON" : "OFF"}
        {" · "}
        {autoLabel}
        {stateLabel ? ` · Engine: ${stateLabel}` : null}
        {" · "}
        Live trading blocked
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 text-xs font-semibold sm:text-sm">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/12 px-3 py-1.5 text-amber-50">
        <StatusDot tone="warn" />
        Paper only
      </span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
          orderExecutionEnabled
            ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
            : "border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--muted)]"
        }`}
      >
        <StatusDot tone={orderExecutionEnabled ? "warn" : "neutral"} />
        Execution {orderExecutionEnabled ? "ON" : "OFF"}
      </span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
          autoTradingEnabled
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
            : "border-rose-500/30 bg-rose-500/10 text-rose-100"
        }`}
      >
        <StatusDot tone={autoTradingEnabled ? "ok" : "bad"} />
        {autoLabel}
      </span>
      {stateLabel ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-zinc-200">
          <StatusDot tone="neutral" />
          {stateLabel}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-rose-100">
        <StatusDot tone="bad" />
        Live blocked
      </span>
    </div>
  );
}

export function StatusDot({
  tone = "neutral",
}: {
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const color =
    tone === "ok"
      ? "bg-emerald-400"
      : tone === "warn"
        ? "bg-amber-400"
        : tone === "bad"
          ? "bg-rose-400"
          : "bg-[var(--muted)]";
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`}
    />
  );
}
