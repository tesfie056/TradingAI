"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Small info icon with plain-English tip on hover, focus, or click. */
export function InfoTip({
  text,
  label = "More information",
}: {
  text: string;
  /** Accessible name, e.g. "More information about paper execution" */
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[10px] font-semibold text-[var(--muted)] transition hover:border-zinc-400 hover:text-zinc-200"
      >
        i
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1 w-56 max-w-[min(14rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)] px-2.5 py-2 text-left text-xs font-normal leading-relaxed text-zinc-200 shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
