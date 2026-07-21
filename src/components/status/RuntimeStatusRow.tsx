"use client";

import { formatTime } from "@/lib/format";
import type { StatusItem } from "@/lib/client/status-state-mapper";
import { StatusGlyph } from "@/components/status/StatusGlyph";
import { StatusLight } from "@/components/status/StatusLight";

/** One row in the shared system status panel. */
export function RuntimeStatusRow({ item }: { item: StatusItem }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-zinc-300">
        <StatusGlyph id={item.key} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-zinc-100">{item.name}</p>
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
      </div>
    </div>
  );
}
