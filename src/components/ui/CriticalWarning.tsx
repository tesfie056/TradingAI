"use client";

import type { ReactNode } from "react";
import { useState } from "react";

/**
 * Always-visible serious warning with optional longer explanation.
 */
export function CriticalWarning({
  title,
  children,
  primaryAction,
  secondaryAction,
  whyItMatters,
}: {
  title: string;
  children: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  whyItMatters?: ReactNode;
}) {
  const [whyOpen, setWhyOpen] = useState(false);

  return (
    <div
      role="alert"
      className="rounded-[var(--radius)] border border-amber-500/45 bg-amber-500/10 px-4 py-3 text-sm text-amber-50 shadow-sm shadow-black/15"
    >
      <p className="font-semibold tracking-tight text-amber-50">{title}</p>
      <div className="mt-1.5 text-amber-100/95">{children}</div>
      {(primaryAction || secondaryAction) && (
        <div className="mt-3 flex flex-wrap gap-2">{primaryAction}{secondaryAction}</div>
      )}
      {whyItMatters ? (
        <div className="mt-3 border-t border-amber-500/25 pt-2">
          <button
            type="button"
            className="text-xs font-medium text-amber-100 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-50"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen((v) => !v)}
          >
            {whyOpen ? "Hide why this matters" : "Why this matters"}
          </button>
          {whyOpen ? (
            <div className="mt-2 text-xs leading-relaxed text-amber-100/85">
              {whyItMatters}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
