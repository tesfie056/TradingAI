import { StatusDot } from "@/components/ui/SafetyStrip";

export function ActionBadge({ action }: { action: string }) {
  const normalized = action.toUpperCase();
  const tone =
    normalized === "BUY"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
      : normalized === "SELL"
        ? "bg-rose-500/15 text-rose-200 border-rose-500/30"
        : "bg-zinc-500/15 text-zinc-200 border-zinc-500/25";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold tracking-wide ${tone}`}
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
    <span className={`text-sm font-medium capitalize ${tone}`}>{normalized}</span>
  );
}

export function SentimentBadge({
  sentiment,
}: {
  sentiment?: string | null;
}) {
  if (!sentiment) {
    return <span className="text-sm text-[var(--muted)]">—</span>;
  }
  const tone =
    sentiment === "positive"
      ? "text-emerald-300"
      : sentiment === "negative"
        ? "text-rose-300"
        : "text-[var(--muted)]";
  return (
    <span className={`text-sm font-medium capitalize ${tone}`}>{sentiment}</span>
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
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
      : tone === "warn"
        ? "border-amber-500/35 bg-amber-500/10 text-amber-50"
        : tone === "bad"
          ? "border-rose-500/35 bg-rose-500/10 text-rose-100"
          : tone === "accent"
            ? "border-amber-500/45 bg-amber-500/12 text-amber-50"
            : "border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--muted)]";

  const dotTone =
    tone === "accent" ? "warn" : tone === "neutral" ? "neutral" : tone;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide sm:text-sm ${styles}`}
    >
      <StatusDot tone={dotTone} />
      {label}
    </span>
  );
}

function scoreTone(value: number): string {
  if (value >= 0.65)
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  if (value <= 0.35) return "border-rose-500/30 bg-rose-500/10 text-rose-100";
  return "border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--foreground)]/90";
}

/** Score pills — larger, rounded, readable. */
export function ScoreBadges({
  scores,
  compact = false,
}: {
  scores?: {
    technicalScore: number;
    marketScore: number;
    newsScore: number;
    riskScore: number;
    finalScore: number;
  } | null;
  compact?: boolean;
}) {
  if (!scores) {
    return <span className="text-sm text-[var(--muted)]">—</span>;
  }

  const items = compact
    ? [
        {
          key: "final",
          label: "Score",
          value: scores.finalScore,
          emphasize: true,
        },
      ]
    : [
        { key: "tech", label: "Tech", value: scores.technicalScore },
        { key: "mkt", label: "Market", value: scores.marketScore },
        { key: "news", label: "News", value: scores.newsScore },
        { key: "risk", label: "Risk", value: scores.riskScore },
        {
          key: "final",
          label: "Final",
          value: scores.finalScore,
          emphasize: true,
        },
      ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <span
          key={item.key}
          title={`${item.label} ${(item.value * 100).toFixed(0)}`}
          className={`inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1 text-sm tabular-nums ${
            item.emphasize
              ? "border-amber-500/40 bg-amber-500/12 font-semibold text-amber-50"
              : scoreTone(item.value)
          }`}
        >
          <span className="text-xs opacity-70">{item.label}</span>
          <span className="font-semibold">{(item.value * 100).toFixed(0)}</span>
        </span>
      ))}
    </div>
  );
}

export function ConfidenceBar({
  value,
  label = true,
}: {
  value: number;
  label?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="min-w-[5.5rem]">
      {label ? (
        <div className="mb-1 text-sm tabular-nums text-[var(--foreground)]/90">
          {pct}%
        </div>
      ) : null}
      <div className="confidence-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ExecutionLockHint({
  title = "Order execution off",
}: {
  title?: string;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-100"
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3.5" y="7" width="9" height="7" rx="1" />
        <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
      </svg>
      Locked
    </span>
  );
}
