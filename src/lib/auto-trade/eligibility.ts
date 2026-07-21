/**
 * Auto paper trade eligibility — pure checks, safe to unit-test.
 */

import type { RiskStatus } from "@/lib/alpaca/types";
import type { DataQuality } from "@/lib/alpaca/types";
import {
  getAutoMaxNotionalPerTrade,
  getAutoTradeCooldownMinutes,
  getMaxDailyPaperLoss,
  getMaxDailyPaperTrades,
  getMinConfidenceForAutoTrade,
  isAllowSellAuto,
} from "@/lib/config";
import { WIDE_SPREAD_HOLD_PCT } from "@/lib/market/data-quality";
import type { MonitorOpportunity } from "@/lib/monitor/types";
import type {
  AutoTradeBlocker,
  AutoTradeEligibility,
} from "@/lib/auto-trade/types";

export type AutoTradeEligibilityInput = {
  opportunity: MonitorOpportunity;
  envEnabled: boolean;
  executionEnabled: boolean;
  runtimeBlocked: boolean;
  killSwitch: boolean;
  panicStop: boolean;
  paperEndpointOk: boolean;
  dataQuality: DataQuality;
  riskStatus: RiskStatus;
  estimatedPrice: number | null;
  notional: number;
  dailyTradeCount: number;
  dailyEstimatedPnL: number;
  buyingPower: number | null;
  hasPosition: boolean;
  positionQty: number;
  /** Blocks another BUY soon after a BUY (does not block SELL exits). */
  buyCooldownActive: boolean;
  /** Blocks another SELL soon after a SELL (does not block BUY entries). */
  sellCooldownActive: boolean;
  /** Same symbol already traded in this scan batch. */
  symbolTradedThisScan: boolean;
  opportunityAlreadyProcessed: boolean;
  recentBuyWithoutSell: boolean;
  lastTradeWasLoss: boolean;
};

function blocker(
  code: AutoTradeBlocker["code"],
  message: string,
): AutoTradeBlocker {
  return { code, message };
}

export function evaluateAutoTradeEligibility(
  input: AutoTradeEligibilityInput,
): AutoTradeEligibility {
  const blockers: AutoTradeBlocker[] = [];
  const warnings: string[] = [];
  const opp = input.opportunity;

  if (!input.envEnabled) {
    blockers.push(
      blocker(
        "auto_trading_disabled",
        "Automatic paper trading is disabled. Set AUTO_PAPER_TRADING_ENABLED=true to enable.",
      ),
    );
  }

  if (!input.executionEnabled) {
    blockers.push(
      blocker(
        "execution_disabled",
        "Paper order execution is disabled. Set ENABLE_PAPER_ORDER_EXECUTION=true for auto trades.",
      ),
    );
  }

  if (input.killSwitch) {
    blockers.push(
      blocker("kill_switch_active", "Kill switch is active — auto trading stopped."),
    );
  }

  if (input.panicStop) {
    blockers.push(
      blocker("panic_stop_active", "Panic stop is active — auto trading disabled."),
    );
  }

  if (input.runtimeBlocked) {
    blockers.push(
      blocker(
        "runtime_disabled",
        "New entries are paused. Resume Engine from Auto Trading to allow paper-order submission.",
      ),
    );
  }

  if (!input.paperEndpointOk) {
    blockers.push(
      blocker(
        "live_endpoint",
        "Auto orders only allowed against paper-api.alpaca.markets.",
      ),
    );
  }

  if (opp.action === "HOLD") {
    blockers.push(blocker("hold_action", "HOLD opportunities are never auto-traded."));
  }

  if (opp.action === "WATCH") {
    blockers.push(blocker("watch_action", "WATCH opportunities are never auto-traded."));
  }

  if (opp.action === "SELL" && !isAllowSellAuto()) {
    blockers.push(
      blocker(
        "sell_auto_disabled",
        "Automatic SELL is disabled. Set ALLOW_SELL_AUTO=true to allow.",
      ),
    );
  }

  if (opp.action !== "BUY" && opp.action !== "SELL") {
    blockers.push(
      blocker("missing_data", `Unsupported action "${opp.action}" for auto trade.`),
    );
  }

  if (!opp.readyForPaperPreview) {
    blockers.push(
      blocker("not_ready", "Opportunity is not ready for paper trade preview."),
    );
  }

  const minConf = getMinConfidenceForAutoTrade();
  if (opp.confidence < minConf) {
    blockers.push(
      blocker(
        "low_confidence",
        `Confidence ${(opp.confidence * 100).toFixed(0)}% is below minimum ${(minConf * 100).toFixed(0)}%.`,
      ),
    );
  }

  if (input.riskStatus === "high" || opp.riskScore < 0.4) {
    blockers.push(
      blocker("high_risk", "Auto trading blocked when risk is HIGH."),
    );
  }

  if (
    input.dataQuality.isMarketOpen == null ||
    opp.marketStatus === "unavailable"
  ) {
    blockers.push(
      blocker(
        "market_status_unavailable",
        "Auto trading blocked — market status unavailable (broker clock could not be confirmed).",
      ),
    );
  } else if (
    input.dataQuality.isMarketOpen === false ||
    opp.marketStatus === "closed"
  ) {
    blockers.push(
      blocker(
        "market_closed",
        "Auto trading blocked while the US equity market is closed.",
      ),
    );
  }

  if (input.dataQuality.isQuoteStale) {
    blockers.push(
      blocker("stale_quote", "Auto trading blocked when the quote is stale."),
    );
  }

  if (
    input.dataQuality.spreadPercent != null &&
    input.dataQuality.spreadPercent >= WIDE_SPREAD_HOLD_PCT
  ) {
    blockers.push(
      blocker(
        "wide_spread",
        `Auto trading blocked when spread is too wide (≥${(WIDE_SPREAD_HOLD_PCT * 100).toFixed(0)}%).`,
      ),
    );
  } else if (input.dataQuality.spreadPercent == null) {
    blockers.push(
      blocker("wide_spread", "Auto trading blocked when bid/ask spread cannot be measured."),
    );
  }

  if (input.estimatedPrice == null || !(input.estimatedPrice > 0)) {
    blockers.push(
      blocker("missing_price", "Cannot estimate order price from current quote/bar."),
    );
  }

  if (!(input.notional > 0) || input.notional > getAutoMaxNotionalPerTrade()) {
    blockers.push(
      blocker(
        "max_notional",
        `Notional $${input.notional.toFixed(2)} exceeds max $${getAutoMaxNotionalPerTrade().toFixed(2)} per auto trade.`,
      ),
    );
  }

  const maxDaily = getMaxDailyPaperTrades();
  if (input.dailyTradeCount >= maxDaily) {
    blockers.push(
      blocker(
        "max_daily_trades",
        `Daily auto paper trade limit reached (${maxDaily}).`,
      ),
    );
  }

  const maxLoss = getMaxDailyPaperLoss();
  if (input.dailyEstimatedPnL <= -maxLoss) {
    blockers.push(
      blocker(
        "max_daily_loss",
        `Daily estimated loss limit reached ($${maxLoss.toFixed(2)}).`,
      ),
    );
  }

  if (input.buyCooldownActive && opp.action === "BUY") {
    blockers.push(
      blocker(
        "duplicate_symbol",
        `No duplicate trade on ${opp.symbol} — ${getAutoTradeCooldownMinutes()} min since last BUY.`,
      ),
    );
  }

  if (input.sellCooldownActive && opp.action === "SELL") {
    blockers.push(
      blocker(
        "symbol_cooldown",
        `SELL cooldown active for ${opp.symbol} (${getAutoTradeCooldownMinutes()} min since last SELL).`,
      ),
    );
  }

  if (input.opportunityAlreadyProcessed) {
    blockers.push(
      blocker(
        "duplicate_opportunity",
        "This opportunity was already processed — one order per opportunity.",
      ),
    );
  }

  if (input.symbolTradedThisScan && opp.action === "BUY") {
    blockers.push(
      blocker(
        "duplicate_symbol",
        `Duplicate BUY blocked for ${opp.symbol} — already traded this scan.`,
      ),
    );
  }

  if (opp.action === "BUY" && input.recentBuyWithoutSell) {
    blockers.push(
      blocker(
        "average_down_blocked",
        `Will not average down on ${opp.symbol} — recent BUY without SELL.`,
      ),
    );
  }

  if (opp.action === "BUY" && input.lastTradeWasLoss) {
    blockers.push(
      blocker(
        "revenge_trade_blocked",
        "Will not re-enter with a BUY immediately after a recent loss on this symbol.",
      ),
    );
  }

  if (opp.action === "BUY") {
    if (input.buyingPower == null) {
      blockers.push(
        blocker("missing_data", "Cannot verify buying power — auto trade blocked."),
      );
    } else if (input.buyingPower < input.notional) {
      blockers.push(
        blocker(
          "insufficient_buying_power",
          `Buying power $${input.buyingPower.toFixed(2)} is below notional $${input.notional.toFixed(2)}.`,
        ),
      );
    }
  }

  if (opp.action === "SELL" && isAllowSellAuto() && !input.hasPosition) {
    blockers.push(
      blocker(
        "no_position_to_sell",
        `No paper position in ${opp.symbol} to sell.`,
      ),
    );
  }

  if (opp.blockedReasons.length > 0 && !opp.readyForPaperPreview) {
    blockers.push(
      blocker("missing_data", "Opportunity has unresolved safety blockers."),
    );
  }

  warnings.push("PAPER TRADE ONLY — not real money. Live trading is blocked.");

  return {
    eligible: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function getCooldownMs(): number {
  return getAutoTradeCooldownMinutes() * 60_000;
}
