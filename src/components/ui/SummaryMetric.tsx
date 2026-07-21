import { InfoTip } from "@/components/ui/InfoTip";

export function SummaryMetric({
  label,
  value,
  tip,
  valueClass = "text-zinc-100",
}: {
  label: string;
  value: string;
  tip?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 shadow-sm shadow-black/10">
      <dt className="text-xs text-[var(--muted)]">
        {label}
        {tip ? <InfoTip text={tip} /> : null}
      </dt>
      <dd className={`mt-1 text-base font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
    </div>
  );
}
