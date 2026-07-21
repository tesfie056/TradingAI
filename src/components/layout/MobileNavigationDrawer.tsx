"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { PaperTradingBadge } from "@/components/ui/PaperTradingBadge";
import { NavIcon } from "@/components/layout/NavIcon";
import { SystemStatusPopover } from "@/components/layout/SystemStatusPopover";
import { isNavActive, NAV_GROUPS } from "@/lib/client/nav-config";
import type { SystemStatusPopoverProps } from "@/components/layout/SystemStatusPopover";

export function MobileNavigationDrawer({
  open,
  onClose,
  status,
  onAskAi,
  aiThinking = false,
  aiResultsReady = 0,
  onOpenSystemStatus,
}: {
  open: boolean;
  onClose: () => void;
  status: SystemStatusPopoverProps;
  onAskAi: () => void;
  aiThinking?: boolean;
  aiResultsReady?: number;
  onOpenSystemStatus?: () => void;
}) {
  const pathname = usePathname();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    const panel = closeRef.current?.closest('[role="dialog"]');

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !(panel instanceof HTMLElement)) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Close navigation menu"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 left-0 flex w-[min(100vw-3rem,20rem)] flex-col border-r border-[var(--border)] bg-[var(--panel)] shadow-xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-4">
          <div>
            <p
              id={titleId}
              className="font-[family-name:var(--font-display)] text-xl tracking-tight"
            >
              TradingAI
            </p>
            <div className="mt-1.5">
              <PaperTradingBadge />
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="ui-btn min-h-11 border border-[var(--border)] px-3 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <nav aria-label="Mobile primary" className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-4">
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium ${
                          active
                            ? "bg-[var(--panel-elevated)] text-[var(--foreground)]"
                            : "text-[var(--muted)] hover:bg-[var(--panel-elevated)]/70"
                        }`}
                        aria-current={active ? "page" : undefined}
                      >
                        <NavIcon id={item.icon} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t border-[var(--border)] p-3">
          <button
            type="button"
            className="ui-btn flex min-h-11 w-full items-center justify-center gap-2 border border-amber-500/40 bg-amber-500/12 text-amber-50"
            onClick={() => {
              onAskAi();
              onClose();
            }}
          >
            AI Assistant
            {aiThinking ? " · Thinking" : null}
            {!aiThinking && aiResultsReady > 0 ? ` · ${aiResultsReady}` : null}
          </button>
          <SystemStatusPopover
            {...status}
            placement="top"
            onOpenPanel={onOpenSystemStatus}
          />
        </div>
      </div>
    </div>
  );
}
