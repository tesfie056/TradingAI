/** Shared paper-only banner — one soft reminder, not a wall of warnings. */
export function PaperOnlyBanner({ detail }: { detail?: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-50/95">
      <span className="font-semibold">Paper trading only</span>
      <span className="text-amber-100/80">
        {" "}
        · no live trading · no automatic trading · U.S. stocks only
        {detail ? ` · ${detail}` : ""}
      </span>
    </div>
  );
}
