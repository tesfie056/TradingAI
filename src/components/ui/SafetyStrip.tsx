"use client";

export function SafetyStrip({
  orderExecutionEnabled,
  compact = false,
}: {
  orderExecutionEnabled: boolean;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <p className="text-sm leading-relaxed text-amber-100/90">
        <span className="font-semibold">Paper only</span>
        {" · "}
        Execution {orderExecutionEnabled ? "ON" : "OFF"}
        {" · "}
        No automatic trading
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
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-rose-100">
        <StatusDot tone="bad" />
        No auto-trading
      </span>
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
