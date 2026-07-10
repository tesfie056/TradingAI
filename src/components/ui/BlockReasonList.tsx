"use client";

import { useState } from "react";
import {
  blockTone,
  classifyBlockText,
  type BlockReasonKind,
  uniqueBlockLabels,
} from "@/lib/client/block-reasons";

function ReasonBadge({ label }: { label: string }) {
  const kind = classifyBlockText(label);
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${blockTone(kind)}`}
    >
      {label}
    </span>
  );
}

export function BlockReasonList({
  reasons,
  emptyLabel = "—",
  maxVisible,
  layout = "stack",
  excludeKinds = [],
}: {
  reasons: string[];
  emptyLabel?: string;
  maxVisible?: number;
  layout?: "stack" | "inline";
  excludeKinds?: BlockReasonKind[];
}) {
  const [expanded, setExpanded] = useState(false);
  const labels = uniqueBlockLabels(reasons.filter(Boolean)).filter((label) => {
    if (excludeKinds.length === 0) return true;
    return !excludeKinds.includes(classifyBlockText(label));
  });

  if (labels.length === 0) {
    return <span className="text-sm text-[var(--muted)]">{emptyLabel}</span>;
  }

  const limit =
    maxVisible != null && maxVisible > 0 && !expanded
      ? maxVisible
      : labels.length;
  const visible = labels.slice(0, limit);
  const hiddenCount = labels.length - visible.length;
  const listClass =
    layout === "inline"
      ? "flex flex-wrap items-center gap-1.5"
      : "flex flex-col gap-1.5";

  return (
    <div className="flex flex-col gap-1.5">
      <ul className={listClass}>
        {visible.map((label) => (
          <li
            key={label}
            className={layout === "inline" ? "inline-flex" : undefined}
          >
            <ReasonBadge label={label} />
          </li>
        ))}
        {hiddenCount > 0 && (
          <li className={layout === "inline" ? "inline-flex" : undefined}>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex rounded-full border border-[var(--border)] bg-[var(--panel-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-amber-500/40 hover:text-amber-100"
            >
              +{hiddenCount} more
            </button>
          </li>
        )}
        {expanded && maxVisible != null && labels.length > maxVisible && (
          <li className={layout === "inline" ? "inline-flex" : undefined}>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-sm font-medium text-[var(--muted)] underline-offset-2 hover:text-amber-100 hover:underline"
            >
              Show less
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
