"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fetchJson } from "@/lib/client/fetch-json";
import {
  filterLocalSymbols,
  formatPrice,
  looksLikeTicker,
  normalizeTicker,
} from "@/lib/client/stock-search";
import { getLocalWatchlistSymbols } from "@/lib/client/ui-settings";
import { useStockWorkspace } from "@/components/stock/StockWorkspaceContext";
import {
  LEGACY_MEGA_CAP_WATCHLIST,
  V1_DEFAULT_WATCHLIST,
} from "@/lib/universe/v1-default-watchlist";
import { DEFAULT_PAPER_SOAK_WATCHLIST } from "@/lib/universe/paper-soak-watchlist";

/** Desk-known tickers used only for local prefix suggestions (not an API call). */
const SUGGESTION_UNIVERSE = [
  ...V1_DEFAULT_WATCHLIST,
  ...LEGACY_MEGA_CAP_WATCHLIST,
  ...DEFAULT_PAPER_SOAK_WATCHLIST,
];

type LookupResponse = {
  ok: boolean;
  symbol?: string;
  name?: string;
  error?: string;
};

type CandidateResponse = {
  ok: boolean;
  asset?: { symbol: string; name: string; exchange: string };
  candidate?: { price: number | null };
  error?: string;
};

type ResultRow = {
  symbol: string;
  name: string | null;
  price: number | null;
  owned: boolean;
};

function dedupeResults(rows: ResultRow[]): ResultRow[] {
  const seen = new Set<string>();
  const out: ResultRow[] = [];
  for (const row of rows) {
    const symbol = normalizeTicker(row.symbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ ...row, symbol });
  }
  return out;
}

function rowsFromLocal(
  symbols: string[],
  ownedSet: Set<string>,
  enrich?: Partial<Record<string, Pick<ResultRow, "name" | "price">>>,
): ResultRow[] {
  return symbols.map((symbol) => ({
    symbol,
    name: enrich?.[symbol]?.name ?? null,
    price: enrich?.[symbol]?.price ?? null,
    owned: ownedSet.has(symbol),
  }));
}

export function StockSearch({
  ownedSymbols = [],
  knownSymbols = [],
  className = "",
}: {
  ownedSymbols?: string[];
  /** Extra symbols for local prefix suggestions (watchlist / decisions). */
  knownSymbols?: string[];
  className?: string;
}) {
  const { openStock } = useStockWorkspace();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const searchGenRef = useRef(0);

  const ownedSet = new Set(ownedSymbols.map((s) => normalizeTicker(s)));

  function applyResults(rows: ResultRow[]) {
    const next = dedupeResults(rows);
    setResults(next);
    setActiveIndex(0);
    setListOpen(next.length > 0);
  }

  function closeDropdown() {
    setListOpen(false);
    setResults([]);
    setActiveIndex(0);
  }

  async function runSearch(raw: string) {
    const gen = ++searchGenRef.current;
    const q = raw.trim();
    setError(null);
    setHint(null);
    setResults([]);
    setListOpen(false);
    if (!q) return;

    const known = [
      ...new Set(
        [
          ...knownSymbols,
          ...getLocalWatchlistSymbols(),
          ...SUGGESTION_UNIVERSE,
        ].map(normalizeTicker),
      ),
    ].filter(Boolean);

    const prefix = looksLikeTicker(q)
      ? normalizeTicker(q)
      : normalizeTicker(q.replace(/\s+/g, ""));

    const localMatches = filterLocalSymbols(prefix || q, known, 24);

    if (!looksLikeTicker(q)) {
      setHint(
        "Enter a ticker symbol (for example AAPL). Company-name search is not available with the current market data API.",
      );
      if (gen !== searchGenRef.current) return;
      if (localMatches.length > 0) {
        applyResults(rowsFromLocal(localMatches, ownedSet));
      }
      return;
    }

    const symbol = normalizeTicker(q);
    setLoading(true);
    try {
      const [lookup, candidate] = await Promise.all([
        fetchJson<LookupResponse>(
          `/api/stocks/lookup?symbol=${encodeURIComponent(symbol)}`,
        ),
        fetchJson<CandidateResponse>(
          `/api/stocks/candidates?symbol=${encodeURIComponent(symbol)}`,
        ).catch(() => null),
      ]);

      if (gen !== searchGenRef.current) return;

      const enrich: Partial<
        Record<string, Pick<ResultRow, "name" | "price">>
      > = {};

      if (lookup.ok && lookup.symbol) {
        const hit = normalizeTicker(lookup.symbol);
        enrich[hit] = {
          name: lookup.name ?? candidate?.asset?.name ?? null,
          price: candidate?.candidate?.price ?? null,
        };
      } else {
        setError(lookup.error ?? `No exact match for ${symbol}.`);
      }

      // Exact API hit first (when present), then remaining local prefix matches.
      const ordered = [
        ...(lookup.ok && lookup.symbol
          ? [normalizeTicker(lookup.symbol)]
          : []),
        ...localMatches.filter(
          (s) =>
            !lookup.ok ||
            !lookup.symbol ||
            s !== normalizeTicker(lookup.symbol),
        ),
      ];

      if (ordered.length === 0) {
        setListOpen(false);
        return;
      }

      applyResults(rowsFromLocal(ordered, ownedSet, enrich));
    } catch (err) {
      if (gen !== searchGenRef.current) return;
      setError(err instanceof Error ? err.message : "Search failed");
      if (localMatches.length > 0) {
        applyResults(rowsFromLocal(localMatches, ownedSet));
      }
    } finally {
      if (gen === searchGenRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!query.trim()) {
      searchGenRef.current += 1;
      closeDropdown();
      setError(null);
      setHint(null);
      setLoading(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void runSearch(query);
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on query only
  }, [query]);

  useEffect(() => {
    if (!listOpen) return;
    const el = optionRefs.current[activeIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listOpen, results.length]);

  function select(symbol: string) {
    openStock(symbol, { intent: "view" });
    closeDropdown();
  }

  const uniqueResults = dedupeResults(results);
  const showList = listOpen && uniqueResults.length > 0;

  return (
    <section
      className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)]/90 p-4 shadow-sm shadow-black/15 ${className}`}
      aria-label="Stock search"
    >
      <h2 className="text-base font-semibold text-zinc-100">Find a stock</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Search by ticker to open details and place a paper trade.
      </p>

      <div className="relative mt-3">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
          aria-hidden
        >
          ⌕
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!showList && uniqueResults.length > 0) {
                setListOpen(true);
                return;
              }
              setActiveIndex((i) =>
                Math.min(i + 1, Math.max(0, uniqueResults.length - 1)),
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (showList && uniqueResults[activeIndex]) {
                select(uniqueResults[activeIndex].symbol);
              } else {
                void runSearch(query);
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (showList) {
                closeDropdown();
              } else {
                setQuery("");
                closeDropdown();
              }
            }
          }}
          placeholder="Search stock symbol or company"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)] py-2.5 pl-9 pr-20 text-sm text-zinc-100 placeholder:text-[var(--muted)]"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showList}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
          {query ? (
            <button
              type="button"
              className="ui-btn border border-[var(--border)] px-2 py-1 text-xs"
              onClick={() => {
                setQuery("");
                closeDropdown();
                inputRef.current?.focus();
              }}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="ui-btn border border-amber-500/40 bg-amber-500/12 px-2 py-1 text-xs text-amber-50"
            onClick={() => void runSearch(query)}
          >
            Search
          </button>
        </div>
      </div>

      <div
        className={`mt-2 ${loading ? "min-h-[3rem]" : "min-h-[1.25rem]"}`}
        aria-live="polite"
      >
        {loading ? (
          <p className="text-xs text-[var(--muted)]">Searching…</p>
        ) : null}
        {error ? <p className="text-xs text-rose-200">{error}</p> : null}
        {hint ? <p className="text-xs text-amber-100/90">{hint}</p> : null}
        {!loading &&
        !error &&
        !hint &&
        query &&
        !showList &&
        uniqueResults.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No matching stocks.</p>
        ) : null}
      </div>

      {showList ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Stock search results"
          className="mt-2 max-h-[calc(3*3.75rem)] overflow-y-auto overflow-x-hidden overscroll-contain rounded-[var(--radius-sm)] border border-[var(--border)] sm:max-h-[calc(5*3.75rem)]"
        >
          {uniqueResults.map((row, index) => (
            <li
              key={row.symbol}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              role="option"
              aria-selected={index === activeIndex}
              className={
                index > 0 ? "border-t border-[var(--border)]/70" : undefined
              }
            >
              <button
                type="button"
                onClick={() => select(row.symbol)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex min-h-[3.75rem] w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition ${
                  index === activeIndex
                    ? "bg-amber-500/10 text-zinc-50"
                    : "bg-[var(--panel-elevated)]/40 hover:bg-[var(--panel-elevated)]"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-50">{row.symbol}</p>
                  <p className="truncate text-xs text-[var(--muted)]">
                    {row.name ?? "U.S. stock"}
                    {row.owned ? " · Already owned" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm tabular-nums text-zinc-100">
                    {formatPrice(row.price)}
                  </p>
                  <span className="text-xs text-amber-100">Open</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
