/**
 * Why automatic paper trading is OFF — user-friendly blockers.
 * Backend safety rules are unchanged; this is presentation only.
 */

import type { AutoTradeStatus } from "@/lib/auto-trade/types";

export type AutoTradeBlockSummaryItem = {
  id: string;
  label: string;
  detail: string;
  active: boolean;
};

export type AutoTradeBlockSummary = {
  runtimeOff: boolean;
  primaryReason: string;
  items: AutoTradeBlockSummaryItem[];
};

export function buildAutoTradeBlockSummary(
  status: Pick<
    AutoTradeStatus,
    | "envEnabled"
    | "executionEnabled"
    | "effectivelyEnabled"
    | "killSwitch"
    | "panicStop"
    | "runtimeDisabled"
    | "dailyTradesUsed"
    | "maxDailyTrades"
    | "activeCooldowns"
    | "nextEligibleAt"
  >,
): AutoTradeBlockSummary {
  const dailyReached = status.dailyTradesUsed >= status.maxDailyTrades;
  const cooldownActive = (status.activeCooldowns?.length ?? 0) > 0;

  const activeParts: string[] = [];
  if (!status.envEnabled) activeParts.push("auto trading is not allowed");
  if (!status.executionEnabled) activeParts.push("paper execution is off");
  if (status.panicStop) activeParts.push("panic stop is ON");
  if (status.killSwitch) activeParts.push("the kill switch is ON");
  if (status.runtimeDisabled) activeParts.push("runtime is disabled");
  if (dailyReached) {
    activeParts.push(
      `the daily trade limit is reached (${status.dailyTradesUsed} of ${status.maxDailyTrades})`,
    );
  }

  let primaryReason: string;
  if (status.effectivelyEnabled && !dailyReached) {
    primaryReason = "Auto trading is active and ready for paper orders.";
  } else if (status.effectivelyEnabled && dailyReached) {
    primaryReason = `Auto trading is paused until tomorrow or until limits are reset. Daily trade limit reached (${status.dailyTradesUsed} of ${status.maxDailyTrades}).`;
  } else if (activeParts.length === 0) {
    primaryReason = "Auto trading is paused.";
  } else if (activeParts.length === 1) {
    if (status.killSwitch && !status.panicStop) {
      primaryReason =
        "Kill switch is ON. Clear Kill Switch, then Resume Engine. Execution and Auto Trading stay OFF until you enable them.";
    } else if (status.runtimeDisabled && !status.panicStop) {
      primaryReason =
        "Engine is paused. Click Resume Engine to restart scanning.";
    } else if (dailyReached && status.envEnabled && status.executionEnabled) {
      primaryReason = `Auto trading is paused until tomorrow or until limits are reset. Daily trade limit reached (${status.dailyTradesUsed} of ${status.maxDailyTrades}).`;
    } else {
      primaryReason = `Auto trading is paused because ${activeParts[0]}.`;
    }
  } else {
    const last = activeParts[activeParts.length - 1];
    const head = activeParts.slice(0, -1).join(", ");
    primaryReason = `Auto trading is paused because ${head} and ${last}.`;
  }

  const items: AutoTradeBlockSummaryItem[] = [
    {
      id: "env",
      label: "Auto trading allowed",
      detail: status.envEnabled ? "Yes" : "No — turn this on in settings",
      active: !status.envEnabled,
    },
    {
      id: "execution",
      label: "Paper execution",
      detail: status.executionEnabled ? "On" : "Off",
      active: !status.executionEnabled,
    },
    {
      id: "kill_switch",
      label: "Kill switch",
      detail: status.killSwitch ? "ON — blocks all auto orders" : "Off",
      active: status.killSwitch,
    },
    {
      id: "panic_stop",
      label: "Panic stop",
      detail: status.panicStop ? "ON — resume blocked until cleared" : "Off",
      active: status.panicStop,
    },
    {
      id: "daily_limit",
      label: "Daily trade limit",
      detail: dailyReached
        ? `Reached ${status.dailyTradesUsed} of ${status.maxDailyTrades}`
        : `${status.dailyTradesUsed} of ${status.maxDailyTrades} used`,
      active: dailyReached,
    },
    {
      id: "cooldown",
      label: "Waiting period",
      detail: cooldownActive
        ? status.activeCooldowns
            .map((c) => `${c.symbol} ${c.side}`)
            .join(", ")
        : "None active",
      active: cooldownActive && status.effectivelyEnabled,
    },
  ];

  return {
    runtimeOff: !status.effectivelyEnabled,
    primaryReason,
    items,
  };
}
