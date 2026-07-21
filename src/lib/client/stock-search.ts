/** Client helpers for ticker lookup (existing /api/stocks/lookup + candidates). */

export type StockLookupResult = {
  symbol: string;
  name: string | null;
  exchange?: string | null;
  price: number | null;
  priceLabel: string;
  ownedQty: number;
};

const TICKER_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

export function looksLikeTicker(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/\s/.test(q)) return false;
  return TICKER_RE.test(q);
}

export function normalizeTicker(query: string): string {
  return query.trim().toUpperCase();
}

export function filterLocalSymbols(
  query: string,
  known: string[],
  limit = 24,
): string[] {
  const q = normalizeTicker(query);
  if (!q) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of known) {
    const s = normalizeTicker(raw);
    if (!s || seen.has(s)) continue;
    if (!s.startsWith(q) && !s.includes(q)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Price unavailable";
  return `$${n.toFixed(2)}`;
}
