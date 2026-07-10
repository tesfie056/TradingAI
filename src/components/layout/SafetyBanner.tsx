"use client";

import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { SafetyStrip } from "@/components/ui/SafetyStrip";

/** Compact shared safety reminder for page tops. */
export function SafetyBanner({
  orderExecutionEnabled,
  detail = "stocks · paper only · no auto trading",
}: {
  orderExecutionEnabled: boolean;
  detail?: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <SafetyStrip orderExecutionEnabled={orderExecutionEnabled} compact />
      <PaperOnlyBanner detail={detail} />
    </div>
  );
}
