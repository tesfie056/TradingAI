export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadRuntimeSettings } = await import(
      "@/lib/auto-trade/runtime-settings/service"
    );
    await loadRuntimeSettings();
    const { ensureMonitorWorkerRunning } = await import("@/lib/monitor/worker");
    await ensureMonitorWorkerRunning();
  }
}
