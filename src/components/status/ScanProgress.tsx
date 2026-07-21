"use client";

/**
 * Honest progress only — never invent evaluated/total counts.
 * When counts are missing, show stage text only.
 */
export function ScanProgress({
  evaluated,
  total,
  currentSymbol,
}: {
  evaluated?: number | null;
  total?: number | null;
  currentSymbol?: string | null;
}) {
  const hasCounts =
    evaluated != null &&
    total != null &&
    Number.isFinite(evaluated) &&
    Number.isFinite(total) &&
    total > 0 &&
    evaluated >= 0 &&
    evaluated <= total;

  if (!hasCounts) {
    return (
      <div className="text-sm text-zinc-200">
        <p>Evaluating the watchlist now.</p>
        {currentSymbol ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Current stock: {currentSymbol}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-sm text-zinc-200">
      <p>
        Checking {evaluated} of {total} stocks
        {currentSymbol ? ` · Current stock: ${currentSymbol}` : ""}
      </p>
      <p className="mt-1 tabular-nums text-xs text-[var(--muted)]">
        Progress: {evaluated} / {total}
      </p>
    </div>
  );
}
