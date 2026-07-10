import type { NewsItem, NewsProvider } from "@/lib/news/types";

/**
 * Deterministic sample headlines for paper-trading decision support.
 * No network calls; no paid APIs.
 */
const MOCK_CATALOG: Omit<NewsItem, "id" | "publishedAt">[] = [
  {
    symbol: "AAPL",
    headline: "Apple suppliers signal steady iPhone build plans",
    source: "MockWire",
    sentiment: "positive",
    importance: "medium",
    summary:
      "Supply-chain chatter points to stable production volumes into the next quarter.",
    possibleMarketImpact:
      "Mildly supportive for near-term sentiment if confirmed by official guidance.",
  },
  {
    symbol: "AAPL",
    headline: "Regulators continue app-store fee scrutiny",
    source: "MockBrief",
    sentiment: "negative",
    importance: "low",
    summary:
      "Ongoing policy reviews keep a modest overhang on services margins.",
    possibleMarketImpact:
      "Limited immediate price impact; longer-term narrative risk.",
  },
  {
    symbol: "MSFT",
    headline: "Enterprise cloud renewals remain resilient in mock survey",
    source: "MockWire",
    sentiment: "positive",
    importance: "medium",
    summary:
      "CIOs in a sample survey report Azure workloads staying on budget.",
    possibleMarketImpact:
      "Supports constructive bias when paired with strong tape.",
  },
  {
    symbol: "GOOGL",
    headline: "Search ad demand described as mixed in mock channel checks",
    source: "MockDesk",
    sentiment: "neutral",
    importance: "medium",
    summary:
      "Advertisers report uneven spend across verticals without a clear trend.",
    possibleMarketImpact: "Neutral; wait for clearer data before leaning hard.",
  },
  {
    symbol: "AMZN",
    headline: "Logistics costs ease slightly in mock freight index",
    source: "MockWire",
    sentiment: "positive",
    importance: "low",
    summary:
      "Sample freight rates tick lower, a small positive for retail margins.",
    possibleMarketImpact: "Minor supportive factor for e-commerce names.",
  },
  {
    symbol: "NVDA",
    headline: "AI accelerator lead times remain tight in mock checks",
    source: "MockChip",
    sentiment: "positive",
    importance: "high",
    summary:
      "Customers still cite constrained supply for high-end GPUs in sample notes.",
    possibleMarketImpact:
      "High-importance bullish narrative; can lift confidence when market data agrees.",
  },
  {
    symbol: "NVDA",
    headline: "Competition rhetoric heats up among AI chip peers",
    source: "MockBrief",
    sentiment: "negative",
    importance: "medium",
    summary:
      "Rivals highlight roadmap milestones; narrative noise increases.",
    possibleMarketImpact:
      "May temper confidence even if trend remains constructive.",
  },
];

export class MockNewsProvider implements NewsProvider {
  readonly name = "mock";

  async getNewsForSymbols(symbols: string[]): Promise<NewsItem[]> {
    const wanted = new Set(symbols.map((s) => s.toUpperCase()));
    const now = Date.now();

    return MOCK_CATALOG.filter((item) => wanted.has(item.symbol)).map(
      (item, index) => ({
        ...item,
        id: `mock-${item.symbol}-${index}`,
        publishedAt: new Date(now - (index + 1) * 3_600_000).toISOString(),
      }),
    );
  }
}
