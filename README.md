# TradingAI

Personal AI **paper-trading** assistant for the [Alpaca Paper Trading API](https://docs.alpaca.markets/).

**Paper trading only.** Live trading is not supported and is blocked in code. The app is read-only against your paper account for balance, market data, AI decisions, and order history. **Order/trade execution is disabled** (`ENABLE_PAPER_ORDER_EXECUTION` must stay unset/false).

## Phase 2 features

- Configurable watchlist via `WATCHLIST` in `.env.local`
- Per-symbol AI decisions (`BUY` / `SELL` / `HOLD`) with confidence, reasons, and risk warnings
- Uses latest price, bid/ask spread, recent 5-minute bars (trend, range/volatility, volume)
- Local decision history log (`data/decision-history.jsonl`, gitignored)
- Dashboard: watchlist table + AI decision per symbol
- Safety guard: paper endpoint only; no auto-trading

## Phase 5 features

- Rich decision history (price, market status, news sentiment, AI provider)
- Outcome tracking at 15m / 1h / approx next close (estimated paper PnL, no orders)
- Dashboard accuracy by symbol/action/confidence + backtest on historical bars
- `GET /api/performance`, `GET /api/backtest`

## Phase 4 features

- `AI_PROVIDER=heuristic | ollama` for local news interpretation
- Ollama server-side client with timeout + heuristic fallback
- News can adjust confidence only; safety HOLDs still win
- Dashboard shows active AI provider and Ollama fallback warnings

## Phase 3.5 features

- `NEWS_PROVIDER=mock | finnhub` selection via env
- Finnhub company-news integration with keyword sentiment
- Safe fallback to mock if key missing, errors, or rate limits
- Dashboard shows active provider + fallback warning + article URLs

## Phase 3 features

- News provider abstraction (`src/lib/news/`) with mock sample headlines
- Per-symbol sentiment / importance / impact analysis
- News nudges confidence only — cannot override closed/stale/wide-spread HOLD
- Dashboard news & events section
- `GET /api/news` and news context on `GET /api/ai/decision`

## Phase 2.5 features

- Alpaca market clock (open/closed, next open/close)
- Quote freshness + wide-spread detection
- Per-symbol `dataQuality` object
- Closed market / stale quote / wide spread → forced HOLD
- Dashboard market status banner + freshness column

## Setup

1. Create a paper account and keys at [Alpaca Paper Dashboard](https://app.alpaca.markets/paper/dashboard/overview).
2. Copy env template:

```bash
cp .env.example .env.local
```

3. Put your **paper** API key and secret in `.env.local`. Do not use live keys.
4. Keep `ALPACA_BASE_URL=https://paper-api.alpaca.markets` (required).
5. Optionally set `WATCHLIST=AAPL,MSFT,GOOGL,AMZN,NVDA`.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Safety

- Trading requests go only through the paper client.
- `assertPaperTradingOnly` rejects `api.alpaca.markets` (live) and any non-paper base URL.
- `/api/safety` reports whether the configured endpoint is allowed.
- Keep secrets in `.env.local` only (gitignored). Never commit API keys.
- `ENABLE_PAPER_ORDER_EXECUTION` is unset/false — the app will not place orders.
- Decision history stores symbols/actions/reasons only — never API keys.

## API routes

| Route | Purpose |
| --- | --- |
| `GET /api/account` | Paper account balance |
| `GET /api/market` | Watchlist quotes / last + data quality |
| `GET /api/market/clock` | Market open/closed + next open/close |
| `GET /api/performance` | Decision outcomes + accuracy summary |
| `GET /api/backtest` | Historical decision simulation (no orders) |
| `GET /api/ai/health` | Ollama connected / fallback status (no prompts) |
| `GET /api/news` | Watchlist news + analysis (mock by default) |
| `GET /api/ai/decision` | Per-symbol AI decisions + news context |
| `GET /api/ai/history` | Local decision history |
| `GET /api/trades` | Paper order history (read-only) |
| `GET /api/safety` | Paper-only endpoint check |

## Verify

```bash
npm run lint
npm run build
npm run verify:phase5
```

## Notes

- AI decisions are heuristics (not a trained model) and **do not place trades**.
- Market data uses `https://data.alpaca.markets` (read-only); account/orders use paper-api only.
