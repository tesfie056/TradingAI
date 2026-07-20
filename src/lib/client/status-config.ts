/**
 * Shared configuration for the global status header and system status panel.
 * Presentation only — does not change backend safety rules.
 */

export type StatusKey =
  | "agent"
  | "safety"
  | "broker"
  | "data"
  | "market"
  | "monitor"
  | "execution"
  | "auto"
  | "ai"
  | "errors";

/** Desktop order (left → right). */
export const STATUS_ORDER: StatusKey[] = [
  "agent",
  "safety",
  "broker",
  "data",
  "market",
  "monitor",
  "execution",
  "auto",
  "ai",
  "errors",
];

/** Tablet: keep these; overflow the rest. */
export const TABLET_PRIORITY: StatusKey[] = [
  "safety",
  "broker",
  "market",
  "monitor",
  "execution",
  "auto",
  "errors",
];

/** Mobile strip: only these (+ overflow for the rest). */
export const MOBILE_PRIORITY: StatusKey[] = [
  "safety",
  "broker",
  "market",
  "auto",
  "errors",
];

export const STATUS_LABELS: Record<StatusKey, string> = {
  agent: "Agent",
  safety: "Safety",
  broker: "Broker",
  data: "Data",
  market: "Market",
  monitor: "Monitor",
  execution: "Paper execution",
  auto: "Auto trading",
  ai: "AI assistant",
  errors: "Errors",
};

export type StatusHref =
  | "/auto-trade"
  | "/monitor"
  | "/trade"
  | "/settings"
  | "/logs"
  | null;

export const STATUS_HREF: Partial<Record<StatusKey, StatusHref>> = {
  safety: "/trade",
  auto: "/auto-trade",
  execution: "/auto-trade",
  monitor: "/monitor",
  agent: "/monitor",
  errors: "/logs",
  ai: "/settings",
};
