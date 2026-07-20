"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { formatTime } from "@/lib/format";
import type { StatusItem } from "@/lib/client/status-state-mapper";
import { StatusGlyph } from "@/components/status/StatusGlyph";
import { StatusLight } from "@/components/status/StatusLight";

function actionLabel(item: StatusItem): string | null {
  if (!item.href) return null;
  if (item.key === "safety" && item.critical) return "Review safety issue";
  if (item.key === "auto" || item.key === "execution") return "Open Auto Trading";
  if (item.key === "monitor" || item.key === "agent") {
    return "Open Advanced Monitoring";
  }
  if (item.key === "errors") return "Open Activity";
  if (item.key === "ai") return "Open Settings";
  return "Open";
}

export function SystemStatusPanel({
  open,
  items,
  onClose,
  onRefresh,
  returnFocusRef,
}: {
  open: boolean;
  items: StatusItem[];
  onClose: () => void;
  onRefresh?: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      returnFocusRef?.current?.focus?.();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-16 sm:pt-20">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close system status"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 max-h-[min(80vh,36rem)] w-full max-w-md overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)] p-4 shadow-xl shadow-black/40"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-zinc-50">
              System status
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Paper trading desk health at a glance.
            </p>
          </div>
          <div className="flex gap-2">
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                className="ui-btn border border-[var(--border)] px-2 py-1 text-xs"
              >
                Refresh
              </button>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="ui-btn border border-[var(--border)] px-2 py-1 text-xs"
            >
              Close
            </button>
          </div>
        </div>

        <ul className="space-y-2">
          {items.map((item) => {
            const action = actionLabel(item);
            return (
              <li
                key={item.key}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/40 px-3 py-2.5"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-zinc-300">
                    <StatusGlyph id={item.key} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">
                        {item.name}
                      </p>
                      <StatusLight tone={item.tone} kind={item.light} />
                      <span className="text-xs text-zinc-300">{item.state}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                      {item.detail}
                    </p>
                    {item.updatedAt ? (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        Updated {formatTime(item.updatedAt)}
                      </p>
                    ) : null}
                    {action && item.href ? (
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className="mt-2 inline-block text-xs text-amber-100 underline"
                      >
                        {action}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
