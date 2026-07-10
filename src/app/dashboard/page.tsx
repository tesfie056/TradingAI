import { Suspense } from "react";
import { ControlRoom } from "@/components/ControlRoom";
import { loadDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initialData = await loadDashboardData();
  return (
    <Suspense fallback={<p className="text-[var(--muted)]">Loading dashboard…</p>}>
      <ControlRoom initialData={initialData} page="dashboard" />
    </Suspense>
  );
}
