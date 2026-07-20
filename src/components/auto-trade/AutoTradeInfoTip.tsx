"use client";

import { useId, useState } from "react";

export function AutoTradeInfoTip({ text }: { text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label="More information"
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border)] text-[10px] font-semibold text-[var(--muted)] transition hover:border-zinc-400 hover:text-zinc-200"
        title={text}
      >
        i
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)] px-2.5 py-2 text-left text-xs font-normal text-zinc-200 shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
