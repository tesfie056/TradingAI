/**
 * Phase 7 — monitoring types.
 * Monitoring detects opportunities only. It never places orders.
 */

export type MonitorSuggestedAction = "BUY" | "SELL" | "HOLD" | "WATCH";

export type MonitorOpportunity = {
  id: string;
  symbol: string;
  action: MonitorSuggestedAction;
  score: number;
  confidence: number;
  reason: string;
  marketStatus: "open" | "closed" | "unknown";
  newsSummary: string;
  timestamp: string;
  expiresAt: string;
  paperOnly: true;
  technicalScore: number;
  newsScore: number;
  marketScore: number;
  riskScore: number;
  blockedReasons: string[];
  readyForPaperPreview: boolean;
  ollamaUsed: boolean;
};

export type MonitorLogLevel = "info" | "warn" | "error";

export type MonitorLogEvent =
  | "scan_started"
  | "scan_completed"
  | "scan_error"
  | "ollama_fallback"
  | "opportunity_created"
  | "opportunity_expired"
  | "monitor_started"
  | "monitor_stopped"
  | "rate_limited"
  | "symbol_scanned";

export type MonitorLogEntry = {
  id: string;
  event: MonitorLogEvent;
  level: MonitorLogLevel;
  message: string;
  timestamp: string;
  paperOnly: true;
  meta?: Record<string, string | number | boolean | null>;
};

export type MonitorNotificationKind =
  | "new_opportunity"
  | "blocked_market_closed"
  | "blocked_stale_quote"
  | "ready_for_preview";

export type MonitorNotification = {
  id: string;
  kind: MonitorNotificationKind;
  title: string;
  detail: string;
  symbol?: string;
  timestamp: string;
  paperOnly: true;
};

export type MonitorAgentStatus = "running" | "stopped" | "scanning";

export type MonitorStatus = {
  paperOnly: true;
  canPlaceOrders: false;
  automaticTradingAllowed: boolean;
  status: MonitorAgentStatus;
  running: boolean;
  scanning: boolean;
  intervalMs: number;
  lastScanAt: string | null;
  nextScanAt: string | null;
  stocksScanned: number;
  /** Watchlist symbols included in the last completed scan. */
  scannedSymbols: string[];
  opportunitiesFound: number;
  activeOpportunities: number;
  topOpportunity: MonitorOpportunity | null;
  /** Clear wording: top signal is chosen from all scanned symbols. */
  topSignalLabel: string;
  lastError: string | null;
  ollamaAvailable: boolean | null;
  notifications: MonitorNotification[];
  recentLogs: MonitorLogEntry[];
  /** Background worker (not page-triggered). */
  workerMode?: boolean;
  marketOpen?: boolean | null;
  heartbeatAt?: string | null;
  intervalOpenMs?: number;
  intervalClosedMs?: number;
};
