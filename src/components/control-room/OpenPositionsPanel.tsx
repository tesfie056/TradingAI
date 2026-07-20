"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompactPositionCard } from "@/components/ui/CompactPositionCard";
import { SummaryMetric } from "@/components/ui/SummaryMetric";
import { useOptionalStockWorkspace } from "@/components/stock/StockWorkspaceContext";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatMoney } from "@/lib/format";

type Position = {
  symbol: string;
  qty: number;
  marketValue: number | null;
  unrealizedPl: number | null;
};

type LifecycleTrade = {
  symbol: string;
  remainingQty?: number;
  filledEntryQty?: number;
  actualAvgEntry?: number | null;
  plannedEntry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  protectionStatus?: string;
  holdingDurationMs?: number | null;
};

function holdLabel(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtUsd(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function protectionLabel(status: string | undefined): {
  label: string;
  tone: "ok" | "warn" | "neutral";
} {
  if (!status) return { label: "Unknown", tone: "neutral" };
  const s = status.toLowerCase();
  if (s.includes("protect") && !s.includes("unprotect") && !s.includes("missing")) {
    return { label: "Protected", tone: "ok" };
  }
  if (
    s.includes("missing") ||
    s.includes("unprotect") ||
    s.includes("orphan") ||
    s.includes("none")
  ) {
    return { label: "Missing", tone: "warn" };
  }
  return { label: status.replace(/_/g, " "), tone: "neutral" };
}

export function OpenPositionsPanel({ currency = "USD" }: { currency?: string }) {
  const stock = useOptionalStockWorkspace();
  const [positions, setPositions] = useState<Position[]>([]);
  const [managed, setManaged] = useState<LifecycleTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [auto, life] = await Promise.all([
          fetchJson<{
            trader?: { openPositions?: Position[] };
          }>("/api/auto-trade").catch(() => null),
          fetchJson<{ active?: LifecycleTrade[] }>(
            "/api/auto-trade/v1-lifecycle",
          ).catch(() => null),
        ]);
        if (cancelled) return;
        setPositions(auto?.trader?.openPositions ?? []);
        setManaged(life?.active ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Panel title="Open positions">
        <p className="text-sm text-[var(--muted)]">Loading positions…</p>
      </Panel>
    );
  }

  const managedBySymbol = new Map(
    managed.map((t) => [t.symbol.toUpperCase(), t]),
  );
  const totalPnl = positions.reduce(
    (sum, p) => sum + (p.unrealizedPl ?? 0),
    0,
  );
  const hasPnl = positions.some((p) => p.unrealizedPl != null);

  const filtered = positions.filter((p) =>
    !query.trim()
      ? true
      : p.symbol.toUpperCase().includes(query.trim().toUpperCase()),
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Position tools" className="shadow-sm shadow-black/15">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <span className="text-sm text-[var(--muted)]">
              Search open positions
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by symbol…"
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm"
            />
          </label>
          <Link
            href="/dashboard"
            className="ui-btn border border-[var(--border)] text-sm"
          >
            Open stock search
          </Link>
        </div>
      </Panel>

      <dl className="grid gap-3 sm:grid-cols-2">
        <SummaryMetric
          label="Open positions"
          tip="Paper positions currently open"
          value={String(positions.length)}
        />
        <SummaryMetric
          label="Current paper P/L"
          tip="Combined unrealized paper profit or loss"
          value={hasPnl ? formatMoney(totalPnl, currency) : "—"}
          valueClass={
            !hasPnl
              ? "text-zinc-100"
              : totalPnl > 0
                ? "text-emerald-300"
                : totalPnl < 0
                  ? "text-red-300"
                  : "text-zinc-100"
          }
        />
      </dl>

      <Panel title="Open positions" className="shadow-sm shadow-black/15">
        {positions.length === 0 ? (
          <EmptyState title="No open paper positions">
            <p>When a paper trade opens, it will appear here.</p>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState title="No matching positions">
            <p>Try a different symbol filter.</p>
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {filtered.map((p) => {
              const detail = managedBySymbol.get(p.symbol.toUpperCase());
              const qty =
                detail?.remainingQty ?? detail?.filledEntryQty ?? p.qty;
              const protect = protectionLabel(detail?.protectionStatus);
              const entry = fmtUsd(
                detail?.actualAvgEntry ?? detail?.plannedEntry,
              );
              const stop = fmtUsd(detail?.stopLoss);
              const take = fmtUsd(detail?.takeProfit);
              const held = holdLabel(detail?.holdingDurationMs);
              const hasEntryDetails = Boolean(entry || stop || take || held);

              return (
                <CompactPositionCard
                  key={`${p.symbol}-${p.qty}`}
                  symbol={p.symbol}
                  qtyLabel={`${qty} ${Math.abs(qty) === 1 ? "share" : "shares"}`}
                  pnlLabel={
                    p.unrealizedPl == null
                      ? "P/L unavailable"
                      : formatMoney(p.unrealizedPl, currency)
                  }
                  pnlClass={
                    (p.unrealizedPl ?? 0) > 0
                      ? "text-emerald-300"
                      : (p.unrealizedPl ?? 0) < 0
                        ? "text-red-300"
                        : "text-zinc-100"
                  }
                  marketValueLabel={
                    p.marketValue != null
                      ? `Market value ${formatMoney(p.marketValue, currency)}`
                      : undefined
                  }
                  protectionLabel={protect.label}
                  protectionTone={protect.tone}
                  onManage={
                    stock
                      ? () => stock.openStock(p.symbol, { intent: "view" })
                      : undefined
                  }
                  expandedDetails={
                    <div className="space-y-2">
                      {hasEntryDetails ? (
                        <ul className="space-y-1 text-zinc-300">
                          {entry ? <li>Entry price: {entry}</li> : null}
                          {stop ? <li>Stop-loss: {stop}</li> : null}
                          {take ? <li>Take-profit: {take}</li> : null}
                          {held ? <li>Time in trade: {held}</li> : null}
                        </ul>
                      ) : (
                        <p className="text-[var(--muted)]">
                          Entry details unavailable
                        </p>
                      )}
                      <ExpandableSection
                        title="Advanced order details"
                        summary="Protection status and managed-trade metadata."
                        expandLabel="View technical order details"
                        collapseLabel="Hide technical order details"
                      >
                        <ul className="space-y-1 text-sm text-[var(--muted)]">
                          <li>
                            Protection:{" "}
                            {detail?.protectionStatus?.replace(/_/g, " ") ??
                              "Not reported"}
                          </li>
                          <li>
                            Managed by Version 1 auto trading.{" "}
                            <Link href="/auto-trade" className="underline">
                              Open Auto Trading
                            </Link>
                          </li>
                        </ul>
                      </ExpandableSection>
                    </div>
                  }
                />
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
