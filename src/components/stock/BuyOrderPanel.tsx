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
import {
  getDefaultQuantitySnapshot,
  loadUiSettings,
} from "@/lib/client/ui-settings";

export function BuyOrderPanel({
  symbol,
  latestPrice,
  onDone,
}: {
  symbol: string;
  latestPrice: number | null;
  onDone?: () => void;
}) {
  const ui = loadUiSettings();
  const [mode, setMode] = useState<"quantity" | "notional">("quantity");
  const [qty, setQty] = useState(getDefaultQuantitySnapshot() || 1);
  const [notional, setNotional] = useState(ui.defaultNotional || 25);
  const [preview, setPreview] = useState<PaperOrderPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function runPreview() {
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
          side: "buy",
          orderMode: mode,
          ...(mode === "notional" ? { notional } : { qty }),
          action: "BUY",
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
            side: "buy",
            orderMode: preview.orderMode,
            ...(preview.orderMode === "notional"
              ? { notional: preview.notional }
              : { qty: preview.qty }),
            action: "BUY",
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
      setSuccess("Paper buy submitted.");
      setPreview(null);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-100">Buy {symbol}</h3>
      <p className="text-xs text-[var(--muted)]">
        Latest price: {formatPrice(latestPrice)}
        <InfoTip
          label="More information about market orders"
          text="Manual paper orders use market day orders. Limit orders are not available on this desk yet."
        />
      </p>

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className={`ui-btn border px-2 py-1 ${
            mode === "quantity"
              ? "border-amber-500/40 bg-amber-500/12 text-amber-50"
              : "border-[var(--border)]"
          }`}
          onClick={() => {
            setMode("quantity");
            setPreview(null);
          }}
        >
          Shares
        </button>
        <button
          type="button"
          className={`ui-btn border px-2 py-1 ${
            mode === "notional"
              ? "border-amber-500/40 bg-amber-500/12 text-amber-50"
              : "border-[var(--border)]"
          }`}
          onClick={() => {
            setMode("notional");
            setPreview(null);
          }}
        >
          Dollar amount
        </button>
      </div>

      {mode === "quantity" ? (
        <label className="block text-sm">
          <span className="text-xs text-[var(--muted)]">
            Quantity
            <InfoTip
              label="More information about quantity"
              text="Number of shares for this paper buy order."
            />
          </span>
          <input
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => {
              setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)));
              setPreview(null);
            }}
            className="mt-1 w-full border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
          />
        </label>
      ) : (
        <label className="block text-sm">
          <span className="text-xs text-[var(--muted)]">
            Dollar amount
            <InfoTip
              label="More information about dollar amount"
              text="Buys an estimated fractional share amount based on the latest price."
            />
          </span>
          <input
            type="number"
            min={1}
            step={1}
            value={notional}
            onChange={(e) => {
              setNotional(Math.max(1, Number(e.target.value) || 1));
              setPreview(null);
            }}
            className="mt-1 w-full border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
          />
        </label>
      )}

      {!preview ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void runPreview()}
          className="ui-btn w-full border border-emerald-500/40 bg-emerald-500/15 py-2 text-sm font-semibold text-emerald-50 disabled:opacity-50"
        >
          {busy ? "Previewing…" : "Preview Buy Order"}
        </button>
      ) : (
        <div className="space-y-3">
          <OrderPreviewCard preview={preview} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy || !preview.canSubmit}
              onClick={() => void confirm()}
              className="ui-btn flex-1 border border-emerald-500/40 bg-emerald-500/15 py-2 text-sm font-semibold text-emerald-50 disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Confirm Paper Buy"}
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
