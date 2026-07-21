/**
 * Presentation helper — one compact system status label for the sidebar.
 * Delegates interpretation to the shared status-state mapper.
 */

import {
  buildSystemStatusItems,
  type SystemStatusSnapshot,
} from "@/lib/client/status-state-mapper";

export type SystemStatusTone = "ok" | "warn" | "bad" | "neutral";

export type SystemStatusInput = {
  safetyOk: boolean;
  marketOpen: boolean | null;
  orderExecutionEnabled: boolean;
  autoTradingEnabled?: boolean;
  agentScanning?: boolean;
  agentRunning?: boolean;
  agentConnected?: boolean;
};

export function resolveSystemStatusLabel(input: SystemStatusInput): {
  label: string;
  tone: SystemStatusTone;
} {
  const items = buildSystemStatusItems(input as SystemStatusSnapshot);
  const critical = items.find((i) => i.critical);
  if (critical) {
    return { label: `${critical.name}: ${critical.state}`, tone: "bad" };
  }
  if (!input.safetyOk) {
    return { label: "Safety blocked", tone: "bad" };
  }
  if (input.agentConnected === false && !input.agentRunning) {
    return { label: "Connection issue", tone: "warn" };
  }
  if (input.marketOpen === false) {
    return { label: "Market closed", tone: "warn" };
  }
  if (input.marketOpen === null) {
    return { label: "Market status unavailable", tone: "warn" };
  }
  if (input.autoTradingEnabled && input.orderExecutionEnabled) {
    return { label: "System ready", tone: "ok" };
  }
  if (!input.autoTradingEnabled) {
    return { label: "Auto trading off", tone: "neutral" };
  }
  if (!input.orderExecutionEnabled) {
    return { label: "Trade execution off", tone: "warn" };
  }
  return { label: "System ready", tone: "ok" };
}
