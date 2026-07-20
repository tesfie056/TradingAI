/**
 * Maps shell + monitor snapshot fields into per-icon status items.
 * Single source of truth for header + sidebar + panel.
 */

import { formatTime } from "@/lib/format";
import {
  STATUS_HREF,
  STATUS_LABELS,
  STATUS_ORDER,
  type StatusHref,
  type StatusKey,
} from "@/lib/client/status-config";
import type { SystemStatusTone } from "@/lib/client/system-status-label";

export type StatusLightKind = "solid" | "ring" | "hollow" | "alert";

export type SystemStatusSnapshot = {
  safetyOk: boolean;
  safetyLabel?: string;
  marketOpen: boolean | null;
  orderExecutionEnabled: boolean;
  autoTradingEnabled?: boolean;
  agentConnected?: boolean;
  agentRunning?: boolean;
  agentScanning?: boolean;
  agentHeartbeatAt?: string | null;
  brokerConnected?: boolean | null;
  aiProvider?: string;
  newsProvider?: string;
  monitorLastError?: string | null;
  monitorLastScanAt?: string | null;
  monitorStocksScanned?: number | null;
  monitorOllamaAvailable?: boolean | null;
  checkedAt?: string | null;
};

export type StatusItem = {
  key: StatusKey;
  name: string;
  tone: SystemStatusTone;
  light: StatusLightKind;
  state: string;
  detail: string;
  tooltip: string;
  visible: boolean;
  critical: boolean;
  count?: number;
  href?: StatusHref;
  updatedAt?: string | null;
};

const HEARTBEAT_STALE_MS = 90_000;
const SCAN_STALE_MS = 5 * 60_000;

function ageMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

function relativeAgo(iso: string | null | undefined): string | null {
  const age = ageMs(iso);
  if (age == null) return null;
  const sec = Math.max(0, Math.floor(age / 1000));
  if (sec < 60) return `${sec} second${sec === 1 ? "" : "s"} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  return `${hr} hour${hr === 1 ? "" : "s"} ago`;
}

function lightFor(tone: SystemStatusTone, critical = false): StatusLightKind {
  if (tone === "bad" || critical) return "alert";
  if (tone === "warn") return "ring";
  if (tone === "ok") return "solid";
  return "hollow";
}

function tip(
  name: string,
  state: string,
  detail: string,
  updatedAt?: string | null,
): string {
  const parts = [`${name} — ${state}`];
  if (detail) parts.push(detail);
  const ago = relativeAgo(updatedAt);
  if (ago) parts.push(`Updated ${ago}`);
  else if (updatedAt) parts.push(`Updated ${formatTime(updatedAt)}`);
  return parts.join(". ");
}

function mapAgent(s: SystemStatusSnapshot): StatusItem {
  const name = STATUS_LABELS.agent;
  const hb = s.agentHeartbeatAt ?? null;
  const stale = (ageMs(hb) ?? Infinity) > HEARTBEAT_STALE_MS;
  let tone: SystemStatusTone = "neutral";
  let state = "Unavailable";
  let detail = "Agent status has not been confirmed.";

  if (s.agentScanning) {
    tone = stale ? "warn" : "ok";
    state = stale ? "Scan delayed" : "Scanning";
    detail = stale
      ? "A scan is active but the last check is delayed."
      : "The monitor agent is scanning the watchlist.";
  } else if (s.agentRunning) {
    tone = stale ? "warn" : "ok";
    state = stale ? "Heartbeat delayed" : "Online";
    detail = stale
      ? "The agent is running but the last check is delayed."
      : "The agent is running with a current heartbeat.";
  } else if (s.agentConnected) {
    tone = "warn";
    state = "Idle";
    detail = "Connected, waiting for the next monitor cycle.";
  } else if (s.agentConnected === false) {
    tone = "bad";
    state = "Unavailable";
    detail = "The live monitor connection is not available.";
  } else {
    tone = "neutral";
    state = "Not connected";
    detail = "Monitor stream has not reported a connection yet.";
  }

  return {
    key: "agent",
    name,
    tone,
    light: lightFor(tone),
    state,
    detail,
    tooltip: tip(name, state, detail, hb),
    visible: true,
    critical: tone === "bad",
    href: STATUS_HREF.agent ?? null,
    updatedAt: hb,
  };
}

function mapSafety(s: SystemStatusSnapshot): StatusItem {
  const name = STATUS_LABELS.safety;
  const checking = s.safetyLabel === "checking";
  let tone: SystemStatusTone = "neutral";
  let state = "Unknown";
  let detail = "Safety state is not available.";

  if (checking) {
    tone = "neutral";
    state = "Checking";
    detail = "Confirming paper-trading safety gates.";
  } else if (s.safetyOk) {
    tone = "ok";
    state = "Protected";
    detail = "Required safety checks passed for paper trading.";
  } else {
    tone = "bad";
    state = "Blocked";
    detail = s.safetyLabel
      ? `Needs attention — ${s.safetyLabel}`
      : "A safety block is active.";
  }

  return {
    key: "safety",
    name,
    tone,
    light: lightFor(tone, tone === "bad"),
    state,
    detail,
    tooltip: tip(name, state, detail, s.checkedAt),
    visible: true,
    critical: tone === "bad",
    href: STATUS_HREF.safety ?? null,
    updatedAt: s.checkedAt ?? null,
  };
}

function mapBroker(s: SystemStatusSnapshot): StatusItem {
  const name = STATUS_LABELS.broker;
  let tone: SystemStatusTone = "neutral";
  let state = "Unknown";
  let detail = "Broker connection has not been checked.";

  if (s.brokerConnected === true) {
    tone = "ok";
    state = "Connected";
    detail = "Paper broker connection is responsive.";
  } else if (s.brokerConnected === false) {
    tone = "bad";
    state = "Disconnected";
    detail = "Paper broker connection failed or is unavailable.";
  }

  return {
    key: "broker",
    name,
    tone,
    light: lightFor(tone),
    state,
    detail,
    tooltip: tip(name, state, detail, s.checkedAt),
    visible: s.brokerConnected != null,
    critical: tone === "bad",
    updatedAt: s.checkedAt ?? null,
  };
}

function mapMarket(s: SystemStatusSnapshot): StatusItem {
  const name = STATUS_LABELS.market;
  let tone: SystemStatusTone = "neutral";
  let state = "Unknown";
  let detail = "Market status is not available.";

  if (s.marketOpen === true) {
    tone = "ok";
    state = "Open";
    detail = "Regular U.S. market session is open.";
  } else if (s.marketOpen === false) {
    tone = "warn";
    state = "Closed";
    detail = "New stock entries are waiting until the market opens.";
  }

  return {
    key: "market",
    name,
    tone,
    light: lightFor(tone),
    state,
    detail,
    tooltip: tip(name, state, detail, s.checkedAt),
    visible: true,
    critical: false,
    updatedAt: s.checkedAt ?? null,
  };
}

function mapAuto(s: SystemStatusSnapshot): StatusItem {
  const name = STATUS_LABELS.auto;
  const on = Boolean(s.autoTradingEnabled);
  let tone: SystemStatusTone = "neutral";
  let state = "Off";
  let detail = "Auto trading is off.";

  if (!s.safetyOk && on) {
    tone = "bad";
    state = "Blocked";
    detail = "Auto trading is on but a safety condition is blocking operation.";
  } else if (on && !s.orderExecutionEnabled) {
    tone = "warn";
    state = "Waiting";
    detail = "Auto trading is on; paper execution is still off.";
  } else if (on) {
    tone = "ok";
    state = "Running";
    detail = "Auto trading is enabled for paper orders.";
  } else {
    tone = "neutral";
    state = "Off";
    detail = "Auto trading is off.";
  }

  return {
    key: "auto",
    name,
    tone,
    light: lightFor(tone),
    state,
    detail,
    tooltip: tip(name, state, detail, s.checkedAt),
    visible: true,
    critical: tone === "bad",
    href: STATUS_HREF.auto ?? null,
    updatedAt: s.checkedAt ?? null,
  };
}

function mapExecution(s: SystemStatusSnapshot): StatusItem {
  const name = STATUS_LABELS.execution;
  const on = s.orderExecutionEnabled;
  const tone: SystemStatusTone = on ? "ok" : "neutral";
  const state = on ? "Enabled" : "Off";
  const detail = on
    ? "Paper order submission is enabled."
    : "Paper order submission is off.";

  return {
    key: "execution",
    name,
    tone,
    light: lightFor(tone),
    state,
    detail,
    tooltip: tip(name, state, detail, s.checkedAt),
    visible: true,
    critical: false,
    href: STATUS_HREF.execution ?? null,
    updatedAt: s.checkedAt ?? null,
  };
}

function mapMonitor(s: SystemStatusSnapshot): StatusItem {
  const name = STATUS_LABELS.monitor;
  const err = s.monitorLastError?.trim() || null;
  const scanAgo = relativeAgo(s.monitorLastScanAt);
  const scanStale =
    s.monitorLastScanAt != null &&
    (ageMs(s.monitorLastScanAt) ?? 0) > SCAN_STALE_MS;

  let tone: SystemStatusTone = "neutral";
  let state = "Stopped";
  let detail = "Monitor is stopped.";

  if (err && (s.agentRunning || s.agentScanning)) {
    tone = "bad";
    state = "Error";
    detail = err;
  } else if (s.agentScanning) {
    tone = "ok";
    state = "Scanning";
    detail = scanAgo ? `Scan in progress · last completed ${scanAgo}` : "Scan in progress.";
  } else if (s.agentRunning) {
    if (scanStale) {
      tone = "warn";
      state = "Scan delayed";
      detail = scanAgo
        ? `Monitor is running · last scan ${scanAgo}`
        : "Monitor is running but the last scan is delayed.";
    } else {
      tone = "ok";
      state = "Running";
      detail = scanAgo
        ? `Monitor is running · last scan ${scanAgo}`
        : "Monitor is running.";
    }
  } else if (s.agentConnected) {
    tone = "warn";
    state = "Waiting";
    detail = "Monitor connection is up; worker is not running.";
  }

  return {
    key: "monitor",
    name,
    tone,
    light: lightFor(tone),
    state,
    detail,
    tooltip: tip(name, state, detail, s.monitorLastScanAt ?? s.agentHeartbeatAt),
    visible: true,
    critical: tone === "bad",
    href: STATUS_HREF.monitor ?? null,
    updatedAt: s.monitorLastScanAt ?? s.agentHeartbeatAt ?? null,
  };
}

function mapData(s: SystemStatusSnapshot): StatusItem | null {
  const hasSignal =
    s.monitorLastScanAt != null ||
    (s.monitorStocksScanned != null && s.monitorStocksScanned > 0) ||
    Boolean(s.monitorLastError);
  if (!hasSignal) return null;

  const name = STATUS_LABELS.data;
  const err = s.monitorLastError?.toLowerCase() ?? "";
  const dataish =
    err.includes("quote") ||
    err.includes("data") ||
    err.includes("bar") ||
    err.includes("stale");

  let tone: SystemStatusTone = "ok";
  let state = "Current";
  let detail = "Recent market-data scan completed.";

  if (dataish) {
    tone = "bad";
    state = "Unavailable";
    detail = s.monitorLastError ?? "Market data is unavailable.";
  } else if (s.marketOpen === false) {
    tone = "warn";
    state = "Waiting";
    detail = "Market is closed · quote activity is limited.";
  } else if (
    s.monitorLastScanAt &&
    (ageMs(s.monitorLastScanAt) ?? 0) > SCAN_STALE_MS
  ) {
    tone = "warn";
    state = "Stale";
    detail = "Latest scan data may be delayed.";
  } else if ((s.monitorStocksScanned ?? 0) > 0) {
    tone = "ok";
    state = "Current";
    detail = `${s.monitorStocksScanned} stock${s.monitorStocksScanned === 1 ? "" : "s"} in the last scan.`;
  }

  return {
    key: "data",
    name,
    tone,
    light: lightFor(tone),
    state,
    detail,
    tooltip: tip(name, state, detail, s.monitorLastScanAt),
    visible: true,
    critical: tone === "bad",
    updatedAt: s.monitorLastScanAt ?? null,
  };
}

function mapAi(s: SystemStatusSnapshot): StatusItem | null {
  const raw = (s.aiProvider ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const isHeuristic =
    lower.includes("heuristic") || lower === "ai fallback: heuristic";
  const ollamaDown = s.monitorOllamaAvailable === false;
  // Show when non-default or when ollama explicitly reported.
  if (isHeuristic && s.monitorOllamaAvailable == null) return null;

  const name = STATUS_LABELS.ai;
  let tone: SystemStatusTone = "ok";
  let state = "Available";
  let detail = raw.startsWith("AI") ? raw : `AI ${raw}`;

  if (ollamaDown || isHeuristic) {
    tone = "warn";
    state = "Fallback";
    detail = "Using the heuristic assistant fallback.";
  } else if (lower.includes("ollama") || lower.includes("connected")) {
    tone = "ok";
    state = "Connected";
    detail = "Local AI provider is available.";
  }

  return {
    key: "ai",
    name,
    tone,
    light: lightFor(tone),
    state,
    detail,
    tooltip: tip(name, state, detail, s.checkedAt),
    visible: true,
    critical: false,
    href: STATUS_HREF.ai ?? null,
    updatedAt: s.checkedAt ?? null,
  };
}

function mapErrors(s: SystemStatusSnapshot, items: StatusItem[]): StatusItem | null {
  const critical = items.filter((i) => i.critical && i.key !== "errors");
  const extras: string[] = [];
  if (!s.safetyOk && s.safetyLabel && s.safetyLabel !== "checking") {
    extras.push(s.safetyLabel);
  }
  if (s.monitorLastError) extras.push(s.monitorLastError);
  const count = Math.max(critical.length, extras.length > 0 ? 1 : 0);
  if (count === 0 && critical.length === 0) return null;

  const name = STATUS_LABELS.errors;
  const tone: SystemStatusTone = "bad";
  const state = count === 1 ? "1 issue" : `${Math.max(count, critical.length)} issues`;
  const detail =
    critical[0]?.detail ??
    extras[0] ??
    "One or more systems need attention.";

  return {
    key: "errors",
    name,
    tone,
    light: "alert",
    state,
    detail,
    tooltip: tip(name, state, detail, s.checkedAt),
    visible: true,
    critical: true,
    count: Math.max(count, critical.length),
    href: STATUS_HREF.errors ?? null,
    updatedAt: s.checkedAt ?? null,
  };
}

export function buildSystemStatusItems(
  snapshot: SystemStatusSnapshot,
): StatusItem[] {
  const base: StatusItem[] = [];
  base.push(mapAgent(snapshot));
  base.push(mapSafety(snapshot));
  const broker = mapBroker(snapshot);
  if (broker.visible) base.push(broker);
  const data = mapData(snapshot);
  if (data) base.push(data);
  base.push(mapMarket(snapshot));
  base.push(mapMonitor(snapshot));
  base.push(mapExecution(snapshot));
  base.push(mapAuto(snapshot));
  const ai = mapAi(snapshot);
  if (ai) base.push(ai);
  const errors = mapErrors(snapshot, base);
  if (errors) base.push(errors);

  const byKey = new Map(base.map((i) => [i.key, i]));
  return STATUS_ORDER.map((k) => byKey.get(k)).filter(
    (i): i is StatusItem => Boolean(i?.visible),
  );
}

export function snapshotFromShellProps(props: {
  safetyOk: boolean;
  safetyLabel?: string;
  marketOpen: boolean | null;
  orderExecutionEnabled: boolean;
  autoTradingEnabled?: boolean;
  agentConnected?: boolean;
  agentRunning?: boolean;
  agentScanning?: boolean;
  agentHeartbeatAt?: string | null;
  brokerConnected?: boolean | null;
  aiProvider?: string;
  newsProvider?: string;
  monitorLastError?: string | null;
  monitorLastScanAt?: string | null;
  monitorStocksScanned?: number | null;
  monitorOllamaAvailable?: boolean | null;
}): SystemStatusSnapshot {
  return {
    ...props,
    checkedAt: new Date().toISOString(),
  };
}
