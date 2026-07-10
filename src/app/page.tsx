import { ControlRoom } from "@/components/ControlRoom";
import { loadDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialData = await loadDashboardData();
  return <ControlRoom initialData={initialData} />;
}
