/**
 * Phase 7 — monitoring types.
 * Monitoring finds setups and hands eligible ones to Auto Trading.
 * This module does not submit broker orders itself.
 */

export type MonitorSuggestedAction = "BUY" | "SELL" | "HOLD" | "WATCH";

export type MonitorOpportunity = {
  id: string;
  symbol: string;
  action: MonitorSuggestedAction;
  score: number;
  confidence: number;
  reason: string;
  marketStatus: "open" | "closed" | "unknown" | "unavailable";
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

export type MonitorScanUiOutcome =
  | "idle"
  | "scheduled"
  | "scanning"
  | "completed"
  | "paused"
  | "failed"
  | "stalled";

export type MonitorScanSummaryView = {
  stocksReceived: number;
  stocksEvaluated: number;
  missingData: number;
  rejectedBySignal: number;
  rejectedBySpread: number;
  rejectedBySafety: number;
  alreadyHeld: number;
  eligible: number;
  ordersSubmitted: number;
  completedAt: string;
};

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
  /** open | closed | unavailable — never conflate failed clock with closed. */
  marketSessionStatus?: "open" | "closed" | "unavailable" | null;
  clockError?: string | null;
  clockFetchedAt?: string | null;
  heartbeatAt?: string | null;
  intervalOpenMs?: number;
  intervalClosedMs?: number;
  /** True when runtime pause / kill / emergency blocks new scans. */
  enginePaused?: boolean;
  pauseReason?: string | null;
  scanOutcome?: MonitorScanUiOutcome;
  /** Configured watchlist size (independent of last scan result). */
  watchlistSize?: number;
  lastSuccessfulScanAt?: string | null;
  lastSkipAt?: string | null;
  scanStartedAt?: string | null;
  scanStalled?: boolean;
  scanSummary?: MonitorScanSummaryView | null;
};
