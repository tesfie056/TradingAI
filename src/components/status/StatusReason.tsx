"use client";

export function StatusReason({
  reason,
  technical,
}: {
  reason: string;
  technical?: string | null;
}) {
  return (
    <div className="text-sm">
      <p className="text-zinc-200">{reason}</p>
      {technical ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-amber-100/90 underline">
            Review details
          </summary>
          <p className="mt-1 text-xs text-[var(--muted)]">{technical}</p>
        </details>
      ) : null}
    </div>
  );
}
