/**
 * Auto paper trading policy — surfaced in API/UI and verification.
 */

import { PAPER_TRADING_BASE_URL } from "@/lib/config";
import {
  getAutoDefaultNotionalAmount,
  getAutoMaxNotionalPerTrade,
  getAutoTradeCooldownMinutes,
  getMaxDailyPaperLoss,
  getMaxDailyPaperTrades,
  getMinConfidenceForAutoTrade,
  isAllowSellAuto,
  isAutoPaperTradingEnabled,
  isPaperOrderExecutionEnabled,
} from "@/lib/config";

export type AutoTradePolicyRule = {
  id: string;
  label: string;
  value: string;
  enforced: true;
};

export function getAutoTradePolicy(): {
  paperOnly: true;
  liveTradingAllowed: false;
  rules: AutoTradePolicyRule[];
} {
  return {
    paperOnly: true,
    liveTradingAllowed: false,
    rules: [
      {
        id: "env_gate",
        label: "AUTO_PAPER_TRADING_ENABLED",
        value: isAutoPaperTradingEnabled() ? "true (active)" : "false (disabled)",
        enforced: true,
      },
      {
        id: "paper_endpoint",
        label: "Trading endpoint",
        value: `Paper only — ${PAPER_TRADING_BASE_URL}`,
        enforced: true,
      },
      {
        id: "default_size",
        label: "Default trade size",
        value: `$${getAutoDefaultNotionalAmount().toFixed(2)} notional`,
        enforced: true,
      },
      {
        id: "max_trade",
        label: "Max per trade",
        value: `$${getAutoMaxNotionalPerTrade().toFixed(2)}`,
        enforced: true,
      },
      {
        id: "max_daily",
        label: "Max trades per day",
        value: `${getMaxDailyPaperTrades()} (set MAX_DAILY_PAPER_TRADES=3–5)`,
        enforced: true,
      },
      {
        id: "cooldown",
        label: "Symbol cooldown",
        value: `${getAutoTradeCooldownMinutes()} minutes (no duplicate BUY on same symbol)`,
        enforced: true,
      },
      {
        id: "sell_auto",
        label: "SELL auto",
        value: isAllowSellAuto()
          ? "enabled (set ALLOW_SELL_AUTO=true)"
          : "disabled first — BUY only until ALLOW_SELL_AUTO=true",
        enforced: true,
      },
      {
        id: "min_confidence",
        label: "Min confidence",
        value: `${(getMinConfidenceForAutoTrade() * 100).toFixed(0)}%`,
        enforced: true,
      },
      {
        id: "max_daily_loss",
        label: "Max daily loss",
        value: `$${getMaxDailyPaperLoss().toFixed(2)} estimated`,
        enforced: true,
      },
      {
        id: "execution",
        label: "Paper execution",
        value: isPaperOrderExecutionEnabled() ? "enabled" : "disabled",
        enforced: true,
      },
      {
        id: "kill_switch",
        label: "Kill switch",
        value: "Stop auto trading now — blocks all auto orders",
        enforced: true,
      },
      {
        id: "panic_stop",
        label: "Panic stop",
        value: "Emergency runtime disable — resume blocked until cleared",
        enforced: true,
      },
      {
        id: "skip_logging",
        label: "Skipped trades",
        value: "Exact reason code + message saved per decision",
        enforced: true,
      },
      {
        id: "placed_logging",
        label: "Placed trades",
        value: "Decision + order response logged before/after submit",
        enforced: true,
      },
    ],
  };
}
