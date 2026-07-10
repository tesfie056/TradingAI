import { subscribeMonitorStream } from "@/lib/monitor/broadcast";
import { getMonitorStatus } from "@/lib/monitor/service";
import { ensureMonitorWorkerRunning } from "@/lib/monitor/worker";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE live stream — heartbeats + scan status (no full page refresh). */
export async function GET(request: Request) {
  await ensureMonitorWorkerRunning();

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      send({
        type: "connected",
        at: new Date().toISOString(),
        ...monitorSafetyFlags(),
      });

      try {
        const status = await getMonitorStatus();
        send({ type: "status", at: new Date().toISOString(), status });
      } catch {
        // client still gets heartbeats
      }

      const unsubscribe = subscribeMonitorStream((event) => {
        send(event);
      });

      request.signal.addEventListener("abort", () => {
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
