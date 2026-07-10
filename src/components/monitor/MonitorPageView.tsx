"use client";

import { useEffect, useState } from "react";
import { MonitoringPanel } from "@/components/monitor/MonitoringPanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { fetchJson } from "@/lib/client/fetch-json";

export function MonitorPageView() {
  const [orderExecutionEnabled, setOrderExecutionEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const trades = await fetchJson<{ orderExecutionEnabled?: boolean }>(
          "/api/trades",
        ).catch(() => null);
        if (!cancelled) {
          setOrderExecutionEnabled(trades?.orderExecutionEnabled ?? false);
        }
      } catch {
        if (!cancelled) setOrderExecutionEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Monitor"
        description="Opportunity scanner for U.S. stocks. Detects setups only — never places orders."
      />
      <SafetyBanner orderExecutionEnabled={orderExecutionEnabled} />
      <MonitoringPanel />
    </div>
  );
}
