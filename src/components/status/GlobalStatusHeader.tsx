"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MOBILE_PRIORITY,
  TABLET_PRIORITY,
  type StatusKey,
} from "@/lib/client/status-config";
import type { StatusItem } from "@/lib/client/status-state-mapper";
import { StatusGlyph } from "@/components/status/StatusGlyph";
import { StatusLight } from "@/components/status/StatusLight";

type Breakpoint = "mobile" | "tablet" | "desktop";

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("desktop");
  useEffect(() => {
    const mqTablet = window.matchMedia("(max-width: 1023px)");
    const mqMobile = window.matchMedia("(max-width: 639px)");
    const update = () => {
      if (mqMobile.matches) setBp("mobile");
      else if (mqTablet.matches) setBp("tablet");
      else setBp("desktop");
    };
    update();
    mqTablet.addEventListener("change", update);
    mqMobile.addEventListener("change", update);
    return () => {
      mqTablet.removeEventListener("change", update);
      mqMobile.removeEventListener("change", update);
    };
  }, []);
  return bp;
}

function StatusIconButton({
  item,
  expanded,
  onOpen,
}: {
  item: StatusItem;
  expanded: boolean;
  onOpen: (el: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      title={item.tooltip}
      aria-label={item.tooltip}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      onClick={(e) => onOpen(e.currentTarget)}
      className="group relative inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-[var(--radius-sm)] text-zinc-300 transition hover:bg-[var(--panel-elevated)]/70 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400/50"
    >
      <StatusGlyph id={item.key} className="h-4 w-4" />
      <StatusLight tone={item.tone} kind={item.light} />
      {item.key === "errors" && item.count && item.count > 0 ? (
        <span className="text-[10px] font-semibold tabular-nums text-rose-200">
          {item.count}
        </span>
      ) : null}
      <span className="sr-only">
        {item.name}: {item.state}. {item.detail}
      </span>
    </button>
  );
}

export function GlobalStatusHeader({
  items,
  open,
  onOpen,
}: {
  items: StatusItem[];
  open: boolean;
  onOpen: (trigger: HTMLElement | null) => void;
}) {
  const bp = useBreakpoint();
  const overflowBtnRef = useRef<HTMLButtonElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const { primary, overflow } = useMemo(() => {
    if (bp === "desktop") {
      return { primary: items, overflow: [] as StatusItem[] };
    }
    const allow = new Set<StatusKey>(
      bp === "mobile" ? MOBILE_PRIORITY : TABLET_PRIORITY,
    );
    for (const item of items) {
      if (item.critical) allow.add(item.key);
    }
    const primaryList = items.filter((i) => allow.has(i.key));
    const overflowList = items.filter((i) => !allow.has(i.key));
    return { primary: primaryList, overflow: overflowList };
  }, [bp, items]);

  useEffect(() => {
    if (!overflowOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOverflowOpen(false);
    }
    function onPointer(e: MouseEvent) {
      const menu = document.getElementById("status-overflow-menu");
      const t = e.target as Node;
      if (overflowBtnRef.current?.contains(t)) return;
      if (menu?.contains(t)) return;
      setOverflowOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [overflowOpen]);

  const showOverflow = overflow.length > 0;

  return (
    <div className="sticky top-0 z-40 border-b border-[var(--border)]/80 bg-[var(--background)]/92 backdrop-blur-md">
      <div className="mx-auto flex h-12 w-full max-w-[1520px] items-center px-4 sm:px-6 lg:px-8">
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5"
          role="toolbar"
          aria-label="System status"
        >
          {primary.map((item) => (
            <StatusIconButton
              key={item.key}
              item={item}
              expanded={open}
              onOpen={(el) => {
                setOverflowOpen(false);
                onOpen(el);
              }}
            />
          ))}

          {showOverflow ? (
            <div className="relative">
              <button
                ref={overflowBtnRef}
                type="button"
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-[var(--radius-sm)] text-zinc-400 hover:bg-[var(--panel-elevated)]/70 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400/50"
                aria-label="More system status"
                aria-expanded={overflowOpen}
                aria-haspopup="menu"
                title="More system status"
                onClick={() => setOverflowOpen((v) => !v)}
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>
              {overflowOpen ? (
                <div
                  id="status-overflow-menu"
                  role="menu"
                  className="absolute left-0 top-full z-50 mt-1 w-56 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-lg shadow-black/40"
                >
                  {overflow.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitem"
                      className="flex w-full min-h-10 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-left text-sm text-zinc-200 hover:bg-[var(--panel-elevated)]"
                      title={item.tooltip}
                      aria-label={item.tooltip}
                      onClick={() => {
                        setOverflowOpen(false);
                        onOpen(overflowBtnRef.current);
                      }}
                    >
                      <StatusGlyph id={item.key} className="h-4 w-4" />
                      <StatusLight tone={item.tone} kind={item.light} />
                      <span className="truncate text-xs text-[var(--muted)]">
                        {item.name}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    className="mt-1 flex w-full min-h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-2 text-xs text-amber-100/90 hover:bg-[var(--panel-elevated)]"
                    title="View all system status details"
                    aria-label="View all system status details"
                    onClick={() => {
                      setOverflowOpen(false);
                      onOpen(overflowBtnRef.current);
                    }}
                  >
                    View all
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
