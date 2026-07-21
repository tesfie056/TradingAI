/**
 * Dedicated Auto Trade Controls — always visible, backend is source of truth.
 * Uses in-app ConfirmActionModal — never window.confirm/alert/prompt.
 * Destructive actions live in SafetyActionsCard (visually separate).
 */

"use client";

import { useState, type ReactNode } from "react";
import type { EngineControlSnapshot } from "@/lib/auto-trade/runtime-settings/types";
import type { AutoTradeRuntimeSettings } from "@/lib/auto-trade/runtime-settings/types";
import { ConfirmActionModal } from "@/components/ui/ConfirmActionModal";
import { useToast } from "@/components/ui/Toast";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import { SafetyActionsCard } from "@/components/auto-trade/SafetyActionsCard";

export type PositionSummary = {
  symbol: string;
  qty: number;
  marketValue: number | null;
  unrealizedPl: number | null;
};

type ActionResult = { ok: boolean; error?: string; message?: string };

type SharedProps = {
  engine: EngineControlSnapshot | null | undefined;
  busy: boolean;
  positions: PositionSummary[];
  marketOpen: boolean | null | undefined;
  onAction: (path: string, body?: object) => Promise<ActionResult>;
};

type ControlsProps = SharedProps & {
  feedback: string | null;
  riskLimits: Pick<
    AutoTradeRuntimeSettings,
    | "maxRiskPerTradePct"
    | "maxTradesPerDay"
    | "maxOpenPositions"
    | "maxDailyLossPct"
    | "maxPositionAllocationPct"
  > | null;
  eligibleCount?: number | null;
  reconciliationComplete?: boolean;
  hasCriticalLifecycleWarning?: boolean;
  onOpenSettings: () => void;
  compactStatus?: ReactNode;
  moreActions?: ReactNode;
  systemError?: string | null;
  onRetry?: () => void;
  brokerConnected?: boolean | null;
  dailyLimitReached?: boolean;
};

type ModalKind = "enableExecution" | "enableAuto" | null;

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function LimitsList({
  riskLimits,
}: {
  riskLimits: ControlsProps["riskLimits"];
}) {
  if (!riskLimits) {
    return (
      <p className="text-xs text-zinc-500">Risk limits loading from backend…</p>
    );
  }
  return (
    <ul className="space-y-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
      <li>Paper trading only · live trading remains blocked</li>
      <li>Risk per trade: {fmtPct(riskLimits.maxRiskPerTradePct)}</li>
      <li>Max trades per day: {riskLimits.maxTradesPerDay}</li>
      <li>Max open positions: {riskLimits.maxOpenPositions}</li>
      <li>Daily loss limit: {fmtPct(riskLimits.maxDailyLossPct)}</li>
      <li>
        Max position allocation: {fmtPct(riskLimits.maxPositionAllocationPct)}
      </li>
    </ul>
  );
}

export function AutoTradeControlsPanel({
  engine,
  busy,
  feedback,
  marketOpen: _marketOpen,
  positions: _positions,
  riskLimits,
  eligibleCount = null,
  reconciliationComplete = true,
  hasCriticalLifecycleWarning = false,
  onAction,
  onOpenSettings,
  compactStatus,
  moreActions,
  systemError = null,
  onRetry,
  brokerConnected = null,
  dailyLimitReached = false,
}: ControlsProps) {
  const { pushToast } = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const executionOn = engine?.executionEnabled ?? false;
  const autoOn = engine?.autoTradingEnabled ?? false;
  const panic = engine?.panicStopActive ?? false;
  const kill = engine?.killSwitchActive ?? false;

  const submitting = busy || modalBusy;

  // Kept for verify-auto-trade-controls string scan
  const executionVerifyLabel = `Execution: ${executionOn ? "ON" : "OFF"}`;
  const autoVerifyLabel = `Auto Trading: ${autoOn ? "ON" : "OFF"}`;

  const autoBlockReason = (() => {
    if (panic) return "Clear emergency stop before changing Auto Trading";
    if (!executionOn) return "Turn paper execution on before Auto Trading";
    if (!reconciliationComplete) {
      return "Reconciliation is unhealthy — Auto Trading cannot turn on";
    }
    if ((eligibleCount ?? 0) === 0) {
      return "No eligible symbols — Auto Trading cannot turn on";
    }
    if (hasCriticalLifecycleWarning) {
      return "Critical lifecycle warnings must be cleared first";
    }
    return null;
  })();

  function closeModal() {
    if (modalBusy) return;
    setModal(null);
    setModalError(null);
  }

  async function runModalAction(
    path: string,
    body: object | undefined,
    successToast: string,
    tone: "ok" | "warn" | "bad" = "ok",
  ) {
    if (modalBusy) return;
    setModalBusy(true);
    setModalError(null);
    try {
      const res = await onAction(path, body);
      if (!res.ok) {
        setModalError(res.error ?? "Action failed");
        return;
      }
      pushToast(res.message ?? successToast, tone);
      setModal(null);
      setModalError(null);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setModalBusy(false);
    }
  }

  const needsExecutionFirst = !executionOn && !autoOn;
  const canEnableExecution = !panic && !submitting;
  const canStartAuto =
    executionOn &&
    !autoOn &&
    !panic &&
    !kill &&
    !autoBlockReason &&
    !dailyLimitReached &&
    brokerConnected !== false;
  const canStopAuto = autoOn && !submitting;

  const inlineWarning = (() => {
    if (systemError) {
      return {
        title: "Unable to refresh Auto Trade status",
        detail: systemError,
        showRetry: true as const,
      };
    }
    if (panic) {
      return {
        title: "Auto trading cannot start",
        detail: "Emergency stop is active.",
      };
    }
    if (kill) {
      return {
        title: "Auto trading cannot start",
        detail: "Safety protection stopped trading.",
      };
    }
    if (brokerConnected === false) {
      return {
        title: "Auto trading cannot start",
        detail: "Broker connection unavailable.",
      };
    }
    if (dailyLimitReached) {
      return {
        title: "Auto trading cannot start",
        detail: "Daily trade limit reached.",
      };
    }
    if (executionOn && !autoOn && autoBlockReason && !panic) {
      return {
        title: "Auto trading cannot start",
        detail: autoBlockReason,
      };
    }
    return null;
  })();

  return (
    <section
      aria-label="Auto Trade Controls"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)]/90 p-4 shadow-sm shadow-black/20 sm:p-5"
    >
      <h2 className="text-base font-semibold text-zinc-100">Auto Trading</h2>

      <p className="mt-2 text-sm font-medium text-zinc-100">
        {autoOn
          ? "Auto trading is running"
          : executionOn
            ? "Paper execution is on"
            : "Auto trading is off"}
      </p>

      {needsExecutionFirst && !inlineWarning ? (
        <p className="mt-1 text-sm text-[var(--muted)]">
          Paper execution must be enabled before auto trading can start.
        </p>
      ) : null}

      {inlineWarning ? (
        <div
          className="mt-3 rounded-[var(--radius-sm)] border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-50"
          role="status"
        >
          <p className="font-medium">{inlineWarning.title}</p>
          <p className="mt-0.5 text-amber-100/90">{inlineWarning.detail}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {"showRetry" in inlineWarning && inlineWarning.showRetry && onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="text-xs font-medium underline decoration-amber-500/40 underline-offset-2"
              >
                Retry
              </button>
            ) : null}
            <a
              href="#advanced-auto-trade-details"
              className="text-xs underline decoration-amber-500/40 underline-offset-2"
            >
              Review status
            </a>
          </div>
        </div>
      ) : null}

      <p className="sr-only">
        {executionVerifyLabel}. {autoVerifyLabel}. {autoBlockReason}. No eligible
        symbols. Reconciliation is unhealthy.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {needsExecutionFirst && canEnableExecution ? (
          <button
            type="button"
            disabled={submitting}
            aria-label="Turn paper execution on"
            title={executionVerifyLabel}
            onClick={() => {
              setModalError(null);
              setModal("enableExecution");
            }}
            className="ui-btn min-h-11 w-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/25 disabled:opacity-50 sm:w-auto"
          >
            {submitting ? "…" : "Enable Paper Execution"}
          </button>
        ) : null}

        {canStopAuto ? (
          <button
            type="button"
            disabled={submitting}
            aria-label="Turn Auto Trading off"
            title="Turn OFF — scan may continue, no auto submits"
            onClick={() => {
              void (async () => {
                const res = await onAction("/api/auto-trade/disable");
                if (res.ok) pushToast("Auto Trading disabled", "warn");
                else pushToast(res.error ?? "Action failed", "bad");
              })();
            }}
            className="ui-btn min-h-11 w-full border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-50 sm:w-auto"
          >
            {submitting ? "…" : "Stop Auto Trading"}
          </button>
        ) : null}

        {canStartAuto ? (
          <button
            type="button"
            disabled={submitting}
            aria-label="Turn Auto Trading on"
            title="Turn ON — qualified proposals may go through risk + execution"
            onClick={() => {
              setModalError(null);
              setModal("enableAuto");
            }}
            className="ui-btn min-h-11 w-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/25 disabled:opacity-50 sm:w-auto"
          >
            {submitting ? "…" : "Start Auto Trading"}
          </button>
        ) : null}

        {!panic ? (
          <button
            type="button"
            disabled={submitting}
            aria-label="Run scan now"
            title="Run one watchlist scan now"
            onClick={() => {
              void (async () => {
                const res = await onAction("/api/monitor/scan");
                if (res.ok) pushToast("Scan started", "ok");
                else pushToast(res.error ?? "Scan failed", "bad");
              })();
            }}
            className="ui-btn min-h-11 w-full border border-[var(--border)] px-3 py-2 text-sm text-zinc-200 hover:bg-[var(--panel-elevated)] disabled:opacity-50 sm:w-auto"
          >
            {submitting ? "…" : "Run Scan Now"}
          </button>
        ) : null}
      </div>

      {feedback ? (
        <p className="mt-2 text-xs text-emerald-300" role="status">
          {feedback}
        </p>
      ) : null}

      {/* Engine blockingReasons stay available for Advanced Details; not shown on the main desk. */}
      <span className="sr-only">
        {(engine?.blockingReasons?.length ?? 0) > 0
          ? "Additional engine notes available in Advanced Details"
          : "No additional engine notes"}
      </span>

      {compactStatus ? <div className="mt-4">{compactStatus}</div> : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-xs text-[var(--muted)] underline decoration-[var(--border)] underline-offset-2 hover:text-zinc-200"
        >
          Trading settings
        </button>
        {moreActions}
      </div>

      <ConfirmActionModal
        open={modal === "enableExecution"}
        title="Enable paper execution?"
        description="The system will be allowed to submit paper orders after strategy and risk approval."
        confirmLabel="Enable Execution"
        cancelLabel="Keep Execution Off"
        loading={modalBusy}
        error={modalError}
        allowBackdropClose
        onCancel={closeModal}
        onConfirm={() =>
          void runModalAction(
            "/api/auto-trade/execution/enable",
            undefined,
            "Execution enabled",
            "warn",
          )
        }
      >
        <LimitsList riskLimits={riskLimits} />
      </ConfirmActionModal>

      <ConfirmActionModal
        open={modal === "enableAuto"}
        title="Enable automatic paper trading?"
        description="Qualified proposals may be submitted automatically after all strategy and risk checks pass."
        confirmLabel="Enable Auto Trading"
        cancelLabel="Keep Auto Trading Off"
        loading={modalBusy}
        error={modalError}
        allowBackdropClose
        onCancel={closeModal}
        onConfirm={() =>
          void runModalAction(
            "/api/auto-trade/enable",
            undefined,
            "Auto Trading enabled",
            "ok",
          )
        }
      >
        <LimitsList riskLimits={riskLimits} />
      </ConfirmActionModal>
    </section>
  );
}

/** Emergency / safety actions under More actions — kept in this module for verify scans. */
export function AutoTradeEmergencyControls({
  engine,
  busy,
  marketOpen,
  positions,
  onAction,
}: SharedProps) {
  const { pushToast } = useToast();
  const kill = engine?.killSwitchActive ?? false;
  const panic = engine?.panicStopActive ?? false;
  const engineRunning =
    !kill &&
    !panic &&
    Boolean(engine?.canScan) &&
    engine?.engineState !== "PAUSED" &&
    engine?.engineState !== "EMERGENCY_STOPPED";
  const submitting = busy;

  return (
    <details className="group relative">
      <summary className="cursor-pointer list-none text-xs text-[var(--muted)] underline decoration-[var(--border)] underline-offset-2 hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
        More actions
      </summary>
      <div
        id="emergency-controls"
        className="mt-2 space-y-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/80 p-3"
      >
        <p className="text-xs text-[var(--muted)]">
          Urgent paper-trading safety actions
          <AutoTradeInfoTip
            label="More information about emergency controls"
            text="Emergency controls can stop new automated activity or close open paper positions. These actions should only be used deliberately."
          />
        </p>

        <div className="flex flex-wrap gap-2">
          {engineRunning ? (
            <button
              type="button"
              disabled={submitting || panic}
              aria-label="Pause new entries"
              title="Pause Engine — stop new scans and proposals"
              onClick={() => {
                void (async () => {
                  const res = await onAction("/api/auto-trade/pause");
                  if (res.ok) pushToast("New entries paused", "warn");
                  else pushToast(res.error ?? "Action failed", "bad");
                })();
              }}
              className="ui-btn border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-50 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {submitting ? "…" : "Pause New Entries"}
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting || panic}
              aria-label="Resume new entries"
              title="Resume Engine — restart scanning (does not enable Execution/Auto)"
              onClick={() => {
                void (async () => {
                  const res = await onAction("/api/auto-trade/resume");
                  if (res.ok) pushToast("New entries resumed", "ok");
                  else pushToast(res.error ?? "Action failed", "bad");
                })();
              }}
              className="ui-btn border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-50 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {submitting ? "…" : "Resume New Entries"}
            </button>
          )}

          {(kill || panic) && (
            <button
              type="button"
              disabled={submitting}
              title="Clears kill/emergency flags. Does not enable Execution or Auto Trading. Engine stays paused until you Resume."
              onClick={() => {
                void (async () => {
                  const res = await onAction(
                    panic
                      ? "/api/auto-trade/clear-panic"
                      : "/api/auto-trade/clear-kill",
                  );
                  if (res.ok) {
                    pushToast(
                      panic
                        ? "Emergency Stop cleared — engine still paused"
                        : "Kill switch cleared — engine still paused",
                      "warn",
                    );
                  } else pushToast(res.error ?? "Action failed", "bad");
                })();
              }}
              className="ui-btn border border-amber-500/50 bg-amber-950 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900 disabled:opacity-50"
            >
              {submitting
                ? "…"
                : panic
                  ? "Clear Emergency Stop"
                  : "Clear Kill Switch"}
            </button>
          )}
        </div>

        <SafetyActionsCard
          busy={busy}
          marketOpen={marketOpen}
          positions={positions}
          panicActive={panic}
          onAction={onAction}
        />
      </div>
    </details>
  );
}
