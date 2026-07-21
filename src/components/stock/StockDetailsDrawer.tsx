"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatPrice } from "@/lib/client/stock-search";
import {
  addLocalWatchlistSymbol,
  getLocalWatchlistSymbols,
  removeLocalWatchlistSymbol,
} from "@/lib/client/ui-settings";
import { InfoTip } from "@/components/ui/InfoTip";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { AdvancedDetails } from "@/components/ui/AdvancedDetails";
import { BuyOrderPanel } from "@/components/stock/BuyOrderPanel";
import { SellOrderPanel } from "@/components/stock/SellOrderPanel";
import { formatMoney } from "@/lib/format";

type Props = {
  symbol: string | null;
  intent: "buy" | "sell" | "view";
  onClose: () => void;
  onIntentChange: (intent: "buy" | "sell" | "view") => void;
};

type PositionRow = {
  symbol: string;
  qty: number;
  marketValue: number | null;
  unrealizedPl: number | null;
};

export function StockDetailsDrawer({
  symbol,
  intent,
  onClose,
  onIntentChange,
}: Props) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [exchange, setExchange] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<PositionRow | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [onWatchlist, setOnWatchlist] = useState(false);
  const [panel, setPanel] = useState<"summary" | "buy" | "sell">("summary");

  useEffect(() => {
    if (!symbol) {
      setPanel("summary");
      return;
    }
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-modal="true"]',
      );
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      previouslyFocused.current?.focus?.();
    };
  }, [symbol, onClose]);

  useEffect(() => {
    if (!symbol) return;
    setPanel(intent === "buy" ? "buy" : intent === "sell" ? "sell" : "summary");
  }, [symbol, intent]);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [lookup, candidate, auto, clock] = await Promise.all([
          fetchJson<{
            ok: boolean;
            symbol?: string;
            name?: string;
            exchange?: string;
            error?: string;
          }>(`/api/stocks/lookup?symbol=${encodeURIComponent(symbol)}`),
          fetchJson<{
            candidate?: { price: number | null };
            asset?: { name: string; exchange: string };
          }>(
            `/api/stocks/candidates?symbol=${encodeURIComponent(symbol)}`,
          ).catch(() => null),
          fetchJson<{
            trader?: {
              openPositions?: PositionRow[];
              marketOpen?: boolean | null;
            };
          }>("/api/auto-trade").catch(() => null),
          fetchJson<{ clock?: { isOpen?: boolean } }>("/api/market/clock").catch(
            () => null,
          ),
        ]);
        if (cancelled) return;
        if (!lookup.ok) {
          setError(lookup.error ?? "Unable to load stock");
          return;
        }
        setName(lookup.name ?? candidate?.asset?.name ?? null);
        setExchange(lookup.exchange ?? candidate?.asset?.exchange ?? null);
        setPrice(candidate?.candidate?.price ?? null);
        const pos =
          auto?.trader?.openPositions?.find(
            (p) => p.symbol.toUpperCase() === symbol.toUpperCase(),
          ) ?? null;
        setPosition(pos && pos.qty > 0 ? pos : null);
        setMarketOpen(
          auto?.trader?.marketOpen ?? clock?.clock?.isOpen ?? null,
        );
        setOnWatchlist(
          getLocalWatchlistSymbols().includes(symbol.toUpperCase()),
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (!symbol) return null;

  const ownedQty = position?.qty ?? 0;
  const canSell = ownedQty > 0;

  function toggleWatchlist() {
    const sym = symbol!.toUpperCase();
    if (onWatchlist) {
      removeLocalWatchlistSymbol(sym);
      setOnWatchlist(false);
    } else {
      addLocalWatchlistSymbol(sym);
      setOnWatchlist(true);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Close stock details"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--panel)] shadow-xl motion-safe:transition-transform sm:max-w-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {symbol}
            </h2>
            <p className="truncate text-sm text-[var(--muted)]">
              {name ?? "U.S. stock"}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ui-btn border border-[var(--border)] px-2 py-1 text-xs"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          ) : error ? (
            <p className="text-sm text-rose-200" role="alert">
              {error}
            </p>
          ) : panel === "buy" ? (
            <BuyOrderPanel
              symbol={symbol}
              latestPrice={price}
              onDone={() => onIntentChange("view")}
            />
          ) : panel === "sell" ? (
            <SellOrderPanel
              symbol={symbol}
              ownedQty={ownedQty}
              latestPrice={price}
              onDone={() => onIntentChange("view")}
            />
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-2xl font-semibold tabular-nums text-zinc-50">
                  {formatPrice(price)}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Market:{" "}
                  {marketOpen == null
                    ? "Unknown"
                    : marketOpen
                      ? "Open"
                      : "Closed"}
                  <InfoTip
                    label="More information about market status"
                    text="New stock entries wait until the regular U.S. market session opens."
                  />
                </p>
                <p className="mt-1 text-sm text-zinc-200">
                  {ownedQty > 0
                    ? `You own ${ownedQty} share${ownedQty === 1 ? "" : "s"}`
                    : "Not owned"}
                </p>
                {position?.unrealizedPl != null ? (
                  <p
                    className={`text-sm ${
                      position.unrealizedPl < 0
                        ? "text-red-300"
                        : position.unrealizedPl > 0
                          ? "text-emerald-300"
                          : "text-zinc-200"
                    }`}
                  >
                    Position P/L: {formatMoney(position.unrealizedPl, "USD")}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onIntentChange("buy");
                    setPanel("buy");
                  }}
                  className="ui-btn w-full border border-emerald-500/40 bg-emerald-500/15 py-2.5 text-sm font-semibold text-emerald-50"
                >
                  Buy
                </button>
                {canSell ? (
                  <button
                    type="button"
                    onClick={() => {
                      onIntentChange("sell");
                      setPanel("sell");
                    }}
                    className="ui-btn w-full border border-amber-500/40 bg-amber-500/12 py-2.5 text-sm font-semibold text-amber-50"
                  >
                    Sell
                  </button>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    Sell unavailable
                    <InfoTip
                      label="More information about selling"
                      text="You must own shares before selling in this long-only paper-trading desk."
                    />
                  </p>
                )}
                <button
                  type="button"
                  onClick={toggleWatchlist}
                  className="ui-btn w-full border border-[var(--border)] py-2 text-sm"
                >
                  {onWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}
                </button>
                {ownedQty > 0 ? (
                  <Link
                    href={`/trade?symbol=${encodeURIComponent(symbol)}`}
                    className="ui-btn w-full border border-[var(--border)] py-2 text-center text-sm"
                    onClick={onClose}
                  >
                    View Position
                  </Link>
                ) : null}
              </div>

              <ExpandableSection
                title="Stock details"
                summary="Exchange and quote context."
                expandLabel="View stock details"
                collapseLabel="Hide stock details"
              >
                <ul className="space-y-1 text-sm text-zinc-300">
                  <li>Exchange: {exchange ?? "Not available"}</li>
                  <li>Latest price: {formatPrice(price)}</li>
                  <li>
                    Watchlist: {onWatchlist ? "Saved locally" : "Not saved"}
                  </li>
                </ul>
              </ExpandableSection>

              <AdvancedDetails
                summary="Bid/ask and raw quote details when available from candidate checks."
              >
                <p className="text-sm text-[var(--muted)]">
                  Manual paper orders use market day orders only. Limit prices,
                  stop-loss, and take-profit are not available on this manual
                  path. Auto trading may apply protection separately.
                </p>
              </AdvancedDetails>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
