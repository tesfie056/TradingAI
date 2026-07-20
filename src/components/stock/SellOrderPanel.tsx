"use client";

import { useState } from "react";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatPrice } from "@/lib/client/stock-search";
import { InfoTip } from "@/components/ui/InfoTip";
import { OrderPreviewCard } from "@/components/stock/OrderPreviewCard";
import type {
  PaperOrderPreview,
  PaperOrderSubmitResult,
} from "@/lib/trades/types";

export function SellOrderPanel({
  symbol,
  ownedQty,
  latestPrice,
  onDone,
}: {
  symbol: string;
  ownedQty: number;
  latestPrice: number | null;
  onDone?: () => void;
}) {
  const maxQty = Math.max(0, ownedQty);
  const [qty, setQty] = useState(Math.max(1, Math.floor(maxQty)));
  const [preview, setPreview] = useState<PaperOrderPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (maxQty <= 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        You must own shares before selling in this long-only paper-trading desk.
        <InfoTip
          label="More information about selling"
          text="This desk does not support short selling. Sell is only available when you hold a positive share quantity."
        />
      </p>
    );
  }

  async function runPreview() {
    const sellQty = Math.min(Math.max(1, Math.floor(qty)), maxQty);
    setQty(sellQty);
    setBusy(true);
    setError(null);
    setSuccess(null);
    setPreview(null);
    try {
      const body = await fetchJson<PaperOrderPreview>("/api/trades/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side: "sell",
          orderMode: "quantity",
          qty: sellQty,
          action: "SELL",
          riskStatus: "unknown",
        }),
      });
      setPreview(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview?.canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<PaperOrderSubmitResult>(
        "/api/trades/submit-paper",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: preview.symbol,
            side: "sell",
            orderMode: "quantity",
            qty: preview.qty,
            action: "SELL",
            riskStatus: preview.riskStatus,
            confirmed: true,
            manualApproval: true,
          }),
        },
      );
      if (!res.submitted) {
        setError(res.error ?? "Order was not submitted");
        return;
      }
      setSuccess("Paper sell submitted.");
      setPreview(null);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  const remaining = Math.max(0, maxQty - (preview?.qty ?? qty));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-100">Sell {symbol}</h3>
      <p className="text-xs text-[var(--muted)]">
        You own {maxQty} · Latest {formatPrice(latestPrice)}
      </p>

      <label className="block text-sm">
        <span className="text-xs text-[var(--muted)]">Quantity to sell</span>
        <input
          type="number"
          min={1}
          max={maxQty}
          step={1}
          value={qty}
          onChange={(e) => {
            const next = Math.floor(Number(e.target.value) || 1);
            setQty(Math.min(maxQty, Math.max(1, next)));
            setPreview(null);
          }}
          className="mt-1 w-full border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
        />
      </label>
      <button
        type="button"
        className="text-xs text-amber-100 underline"
        onClick={() => {
          setQty(maxQty);
          setPreview(null);
        }}
      >
        Sell all
      </button>

      {!preview ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void runPreview()}
          className="ui-btn w-full border border-amber-500/40 bg-amber-500/12 py-2 text-sm font-semibold text-amber-50 disabled:opacity-50"
        >
          {busy ? "Previewing…" : "Preview Sell Order"}
        </button>
      ) : (
        <div className="space-y-3">
          <OrderPreviewCard preview={preview} remainingQty={remaining} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy || !preview.canSubmit}
              onClick={() => void confirm()}
              className="ui-btn flex-1 border border-amber-500/40 bg-amber-500/12 py-2 text-sm font-semibold text-amber-50 disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Confirm Paper Sell"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview(null)}
              className="ui-btn border border-[var(--border)] px-3 py-2 text-sm"
            >
              Edit
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="text-sm text-rose-200" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-emerald-300" role="status">
          {success}
        </p>
      ) : null}
    </div>
  );
}
