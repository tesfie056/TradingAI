"use client";

/** Plain-English scan stage label (never raw enums). */
export function ScanStage({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return (
    <p className="text-xs text-[var(--muted)]">
      Current step: <span className="text-zinc-200">{label}</span>
    </p>
  );
}
