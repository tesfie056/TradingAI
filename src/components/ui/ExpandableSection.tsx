"use client";

import type { ReactNode } from "react";
import { useState } from "react";

/**
 * Soft-professional expandable card for secondary desk information.
 * Collapsed by default unless `defaultOpen` is set.
 * Children stay mounted while collapsed so polling/callbacks continue.
 */
export function ExpandableSection({
  title,
  children,
  defaultOpen = false,
  summary,
  tip,
  expandLabel = "Show details",
  collapseLabel = "Hide details",
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Short line shown when collapsed */
  summary?: ReactNode;
  tip?: ReactNode;
  /** Button label when collapsed */
  expandLabel?: string;
  /** Button label when expanded */
  collapseLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="ui-card flex flex-col gap-3 shadow-sm shadow-black/15">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)] sm:text-lg">
            {title}
          </h2>
          {tip}
        </div>
        <button
          type="button"
          className="ui-btn border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[var(--panel-elevated)] active:scale-[0.98] motion-safe:transition-transform"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? collapseLabel : expandLabel}
        </button>
      </div>
      {!open && summary ? (
        <div className="text-sm text-[var(--muted)]">{summary}</div>
      ) : null}
      <div className={open ? "min-w-0" : "hidden"} aria-hidden={!open}>
        {children}
      </div>
    </section>
  );
}
