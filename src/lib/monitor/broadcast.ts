/**
 * SSE broadcast hub for monitor worker live updates.
 */

import type { MonitorStatus } from "@/lib/monitor/types";

export type MonitorStreamEvent =
  | {
      type: "connected";
      at: string;
      paperOnly: true;
    }
  | {
      type: "heartbeat";
      at: string;
      workerRunning: boolean;
      scanning: boolean;
      marketOpen: boolean | null;
    }
  | {
      type: "status";
      at: string;
      status: MonitorStatus;
    }
  | {
      type: "scan_completed";
      at: string;
      status: MonitorStatus;
    };

type Subscriber = (event: MonitorStreamEvent) => void;

const globalKey = "__tradingai_monitor_broadcast__";

type BroadcastState = {
  subscribers: Set<Subscriber>;
  lastHeartbeatAt: string | null;
  lastStatus: MonitorStatus | null;
  marketOpen: boolean | null;
};

function getBroadcastState(): BroadcastState {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: BroadcastState;
  };
  if (!g[globalKey]) {
    g[globalKey] = {
      subscribers: new Set(),
      lastHeartbeatAt: null,
      lastStatus: null,
      marketOpen: null,
    };
  }
  return g[globalKey]!;
}

export function subscribeMonitorStream(subscriber: Subscriber): () => void {
  const state = getBroadcastState();
  state.subscribers.add(subscriber);
  return () => {
    state.subscribers.delete(subscriber);
  };
}

export function publishMonitorStream(event: MonitorStreamEvent): void {
  const state = getBroadcastState();
  if (event.type === "heartbeat") {
    state.lastHeartbeatAt = event.at;
    state.marketOpen = event.marketOpen;
  }
  if (event.type === "status" || event.type === "scan_completed") {
    state.lastStatus = event.status;
    state.marketOpen = event.status.marketOpen ?? state.marketOpen;
  }
  for (const sub of state.subscribers) {
    try {
      sub(event);
    } catch {
      // ignore broken subscriber
    }
  }
}

export function getLastMonitorHeartbeat(): string | null {
  return getBroadcastState().lastHeartbeatAt;
}

/** Test helper */
export function resetMonitorBroadcastForTests(): void {
  const state = getBroadcastState();
  state.subscribers.clear();
  state.lastHeartbeatAt = null;
  state.lastStatus = null;
  state.marketOpen = null;
}
