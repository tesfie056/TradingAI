import {
  blockTone,
  classifyBlockText,
  uniqueBlockLabels,
} from "@/lib/client/block-reasons";

export function BlockReasonList({
  reasons,
  emptyLabel = "—",
}: {
  reasons: string[];
  emptyLabel?: string;
}) {
  const labels = uniqueBlockLabels(reasons.filter(Boolean));
  if (labels.length === 0) {
    return <span className="text-xs text-[var(--muted)]">{emptyLabel}</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {labels.map((label) => {
        const kind = classifyBlockText(label);
        return (
          <li key={label}>
            <span
              className={`inline-flex border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${blockTone(kind)}`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
