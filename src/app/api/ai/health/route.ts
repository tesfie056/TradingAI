import { NextResponse } from "next/server";
import { checkOllamaHealth, getAiProviderName } from "@/lib/ai/provider";
import { isPaperOrderExecutionEnabled } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Lightweight AI/Ollama health check. No prompts, no secrets, no trading.
 */
export async function GET() {
  const requestedProvider = getAiProviderName();
  const health = await checkOllamaHealth();

  return NextResponse.json({
    paperOnly: true,
    orderExecutionEnabled: isPaperOrderExecutionEnabled(),
    liveTradingAllowed: false,
    requestedProvider,
    ollama: {
      configured: health.ollamaConfigured,
      connected: health.connected,
      model: health.model,
      host: health.baseUrlHost,
      latencyMs: health.latencyMs,
      message: health.message,
    },
    statusLabel:
      requestedProvider !== "ollama"
        ? "heuristic"
        : health.connected
          ? "connected"
          : "fallback",
  });
}
