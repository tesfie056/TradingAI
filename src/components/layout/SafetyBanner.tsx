"use client";

import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { SafetyStrip } from "@/components/ui/SafetyStrip";
import type { AutoTradeEngineState } from "@/lib/auto-trade/runtime-settings/types";

/** Compact shared safety reminder for page tops. */
export function SafetyBanner({
  orderExecutionEnabled,
  autoTradingEnabled,
  engineState,
  detail = "stocks · paper only · live trading blocked",
}: {
  orderExecutionEnabled: boolean;
  autoTradingEnabled?: boolean;
  engineState?: AutoTradeEngineState | string | null;
  detail?: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <SafetyStrip
        orderExecutionEnabled={orderExecutionEnabled}
        autoTradingEnabled={autoTradingEnabled}
        engineState={engineState}
        compact
      />
      <PaperOnlyBanner
        detail={detail}
        autoTradingEnabled={autoTradingEnabled}
      />
    </div>
  );
}
