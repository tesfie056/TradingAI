"use client";

import { MonitoringPanel } from "@/components/monitor/MonitoringPanel";
import { PageHeader } from "@/components/layout/PageHeader";

export function MonitorPageView() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Advanced monitoring"
        description="Scans the watchlist and sends eligible setups to Auto Trading."
      />
      <MonitoringPanel />
    </div>
  );
}
