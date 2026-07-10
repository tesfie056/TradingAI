import { Dashboard } from "@/components/Dashboard";
import { loadDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialData = await loadDashboardData();

  return (
    <main className="flex flex-1 flex-col">
      <Dashboard initialData={initialData} />
    </main>
  );
}
