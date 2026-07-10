export function ActionBadge({ action }: { action: string }) {
  const normalized = action.toUpperCase();
  const tone =
    normalized === "BUY"
      ? "bg-emerald-500/15 text-emerald-300"
      : normalized === "SELL"
        ? "bg-rose-500/15 text-rose-300"
        : "bg-zinc-500/20 text-zinc-300";

  return (
    <span
      className={`inline-flex px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${tone}`}
    >
      {normalized}
    </span>
  );
}

export function RiskBadge({ status }: { status?: string }) {
  if (!status) return null;
  const normalized = status === "elevated" ? "medium" : status;
  const tone =
    normalized === "high"
      ? "text-rose-300"
      : normalized === "medium"
        ? "text-amber-300"
        : normalized === "low"
          ? "text-emerald-300"
          : "text-[var(--muted)]";
  return (
    <span className={`text-xs uppercase tracking-wide ${tone}`}>
      {normalized}
    </span>
  );
}

export function SentimentBadge({
  sentiment,
}: {
  sentiment?: string | null;
}) {
  if (!sentiment) {
    return <span className="text-xs text-[var(--muted)]">—</span>;
  }
  const tone =
    sentiment === "positive"
      ? "text-emerald-300"
      : sentiment === "negative"
        ? "text-rose-300"
        : "text-[var(--muted)]";
  return (
    <span className={`text-xs uppercase tracking-wide ${tone}`}>
      {sentiment}
    </span>
  );
}

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "ok" | "warn" | "bad" | "neutral" | "accent";
}) {
  const styles =
    tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
        : tone === "bad"
          ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
          : tone === "accent"
            ? "border-amber-500/50 bg-amber-500/15 text-amber-50"
            : "border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--muted)]";

  return (
    <span
      className={`inline-flex items-center border px-2 py-1 text-[11px] font-semibold tracking-wide uppercase ${styles}`}
    >
      {label}
    </span>
  );
}
