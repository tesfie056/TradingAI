import {
  BLOCKED_TRADING_HOSTS,
  PAPER_TRADING_BASE_URL,
} from "@/lib/config";

export class PaperTradingSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperTradingSafetyError";
  }
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new PaperTradingSafetyError(
      `Invalid Alpaca base URL: "${url}". Expected ${PAPER_TRADING_BASE_URL}`,
    );
  }
}

/**
 * Strict guard: only the Alpaca paper trading endpoint is allowed for
 * account/order requests. Live trading hosts are rejected.
 */
export function assertPaperTradingOnly(baseUrl: string): void {
  const host = normalizeHost(baseUrl);
  const paperHost = normalizeHost(PAPER_TRADING_BASE_URL);

  if (host === "api.alpaca.markets") {
    throw new PaperTradingSafetyError(
      `LIVE trading endpoint blocked. Refusing host "${host}". Use paper only: ${PAPER_TRADING_BASE_URL}`,
    );
  }

  for (const blocked of BLOCKED_TRADING_HOSTS) {
    const blockedHost = blocked.replace(/\/$/, "").toLowerCase();
    if (host === blockedHost) {
      throw new PaperTradingSafetyError(
        `Blocked trading host "${host}". Paper trading only.`,
      );
    }
  }

  if (host !== paperHost) {
    throw new PaperTradingSafetyError(
      `Only paper trading is allowed. Got "${host}", expected "${paperHost}" (${PAPER_TRADING_BASE_URL}).`,
    );
  }

  if (!baseUrl.toLowerCase().includes("paper-api")) {
    throw new PaperTradingSafetyError(
      `ALPACA_BASE_URL must include "paper-api". Got: ${baseUrl}`,
    );
  }
}

/** Validate a full request URL before any trading API call. */
export function assertSafeTradingRequestUrl(requestUrl: string): void {
  const host = normalizeHost(requestUrl);

  if (host === "api.alpaca.markets") {
    throw new PaperTradingSafetyError(
      `Blocked live trading request to ${requestUrl}`,
    );
  }

  if (host !== normalizeHost(PAPER_TRADING_BASE_URL)) {
    throw new PaperTradingSafetyError(
      `Trading requests must use paper-api only. Blocked: ${requestUrl}`,
    );
  }
}
