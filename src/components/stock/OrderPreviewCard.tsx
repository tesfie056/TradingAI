"use client";

import type { PaperOrderPreview } from "@/lib/trades/types";
import { formatPrice } from "@/lib/client/stock-search";
import { InfoTip } from "@/components/ui/InfoTip";

export function OrderPreviewCard({
  preview,
  remainingQty,
}: {
  preview: PaperOrderPreview;
  remainingQty?: number | null;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-100">
        Paper trade only
        <InfoTip
          label="More information about paper trading"
          text="This preview is for simulated paper orders only. Live order submission stays disabled."
        />
      </p>
      <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--muted)]">Action</dt>
          <dd className="font-semibold uppercase text-zinc-100">{preview.side}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Symbol</dt>
          <dd className="font-semibold text-zinc-100">{preview.symbol}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Order type</dt>
          <dd className="text-zinc-100">Market · Day</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Quantity</dt>
          <dd className="tabular-nums text-zinc-100">
            {preview.orderMode === "notional"
              ? `${preview.estimatedShares?.toFixed(4) ?? "—"} shares (est.)`
              : preview.qty}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Estimated price</dt>
          <dd className="tabular-nums text-zinc-100">
            {formatPrice(preview.estimatedPrice)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Estimated total</dt>
          <dd className="tabular-nums text-zinc-100">
            {formatPrice(preview.estimatedNotional)}
          </dd>
        </div>
        {remainingQty != null ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-[var(--muted)]">Remaining after sale</dt>
            <dd className="tabular-nums text-zinc-100">{remainingQty}</dd>
          </div>
        ) : null}
      </dl>
      {!preview.canSubmit ? (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-rose-200">
          {preview.gates.blockers.map((b) => (
            <li key={b.code}>{b.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
