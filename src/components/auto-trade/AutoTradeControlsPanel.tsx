/**
 * Dedicated Auto Trade Controls — always visible, backend is source of truth.
 * Uses in-app ConfirmActionModal — never window.confirm/alert/prompt.
 * Destructive actions live in SafetyActionsCard (visually separate).
 */

"use client";

import { useState } from "react";
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

type Props = {
  engine: EngineControlSnapshot | null | undefined;
  busy: boolean;
  feedback: string | null;
  marketOpen: boolean | null | undefined;
  positions: PositionSummary[];
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
  onAction: (path: string, body?: object) => Promise<ActionResult>;
  onOpenSettings: () => void;
};

type ModalKind = "enableExecution" | "enableAuto" | null;

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function LimitsList({
  riskLimits,
}: {
  riskLimits: Props["riskLimits"];
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
  marketOpen,
  positions,
  riskLimits,
  eligibleCount = null,
  reconciliationComplete = true,
  hasCriticalLifecycleWarning = false,
  onAction,
  onOpenSettings,
}: Props) {
  const { pushToast } = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const executionOn = engine?.executionEnabled ?? false;
  const autoOn = engine?.autoTradingEnabled ?? false;
  const kill = engine?.killSwitchActive ?? false;
  const panic = engine?.panicStopActive ?? false;
  const engineRunning =
    !kill &&
    !panic &&
    Boolean(engine?.canScan) &&
    engine?.engineState !== "PAUSED" &&
    engine?.engineState !== "EMERGENCY_STOPPED";

  const submitting = busy || modalBusy;

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

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Auto Trade Controls"
        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)]/90 p-4 shadow-sm shadow-black/20"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">Main controls</h2>
          <button
            type="button"
            onClick={onOpenSettings}
            className="ui-btn border border-[var(--border)] px-2 py-1 text-xs text-zinc-300 hover:bg-[var(--panel-elevated)]"
          >
            Trading Settings…
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
          <span>
            Auto Trading
            <AutoTradeInfoTip text="Controls the automated paper workflow. Requires confirmation to turn on." />
          </span>
          <span className="mx-1">·</span>
          <span>
            Paper Execution
            <AutoTradeInfoTip text="Paper-only order submission. Does not unlock live trading." />
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={submitting || panic}
            aria-label={
              executionOn
                ? "Turn paper execution off"
                : "Turn paper execution on"
            }
            title={
              panic
                ? "Clear emergency stop before changing execution"
                : executionOn
                  ? "Turn OFF — no broker orders can be submitted"
                  : "Turn ON — paper orders may submit after risk approval"
            }
            onClick={() => {
              if (executionOn) {
                void (async () => {
                  const res = await onAction("/api/auto-trade/execution/disable");
                  if (res.ok) pushToast("Execution disabled", "warn");
                  else pushToast(res.error ?? "Action failed", "bad");
                })();
                return;
              }
              setModalError(null);
              setModal("enableExecution");
            }}
            className={`ui-btn min-h-11 min-w-[9.5rem] px-3 py-2 text-sm font-medium disabled:opacity-50 ${
              executionOn
                ? "bg-amber-700 text-white hover:bg-amber-600"
                : "border border-zinc-500 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            }`}
          >
            {submitting ? "…" : `Execution: ${executionOn ? "ON" : "OFF"}`}
          </button>

          <button
            type="button"
            disabled={submitting || panic || (!autoOn && Boolean(autoBlockReason))}
            aria-label={
              autoOn ? "Turn Auto Trading off" : "Turn Auto Trading on"
            }
            title={
              autoOn
                ? "Turn OFF — scan may continue, no auto submits"
                : (autoBlockReason ??
                  "Turn ON — qualified proposals may go through risk + execution")
            }
            onClick={() => {
              if (autoOn) {
                void (async () => {
                  const res = await onAction("/api/auto-trade/disable");
                  if (res.ok) pushToast("Auto Trading disabled", "warn");
                  else pushToast(res.error ?? "Action failed", "bad");
                })();
                return;
              }
              if (autoBlockReason) {
                pushToast(autoBlockReason, "warn");
                return;
              }
              setModalError(null);
              setModal("enableAuto");
            }}
            className={`ui-btn min-h-11 min-w-[10.5rem] px-3 py-2 text-sm font-medium disabled:opacity-50 ${
              autoOn
                ? "bg-emerald-700 text-white hover:bg-emerald-600"
                : "border border-zinc-500 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            }`}
          >
            {submitting ? "…" : `Auto Trading: ${autoOn ? "ON" : "OFF"}`}
          </button>

          <button
            type="button"
            disabled={submitting || panic}
            aria-label="Run scan now"
            title="Run one watchlist scan now"
            onClick={() => {
              void (async () => {
                const res = await onAction("/api/monitor/scan");
                if (res.ok) pushToast("Scan started", "ok");
                else pushToast(res.error ?? "Scan failed", "bad");
              })();
            }}
            className="ui-btn min-h-11 border border-sky-500/40 bg-sky-950/40 px-3 py-2 text-sm font-medium text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
          >
            {submitting ? "…" : "Run Scan Now"}
          </button>

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
              className="ui-btn min-h-11 bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
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
              className="ui-btn min-h-11 bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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
              className="ui-btn min-h-11 border border-amber-500/50 bg-amber-950 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-900 disabled:opacity-50"
            >
              {submitting
                ? "…"
                : panic
                  ? "Clear Emergency Stop"
                  : "Clear Kill Switch"}
            </button>
          )}
        </div>

        {!autoOn && autoBlockReason ? (
          <p className="mt-3 text-xs text-amber-200">{autoBlockReason}</p>
        ) : null}

        {(engine?.blockingReasons?.length ?? 0) > 0 ? (
          <ul className="mt-3 space-y-0.5 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {engine!.blockingReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}

        {feedback ? (
          <p className="mt-2 text-xs text-emerald-300" role="status">
            {feedback}
          </p>
        ) : null}

        <p className="mt-3 text-[11px] text-[var(--muted)]">
          Paper only. Live trading remains blocked. Paper execution and Auto
          Trading still require risk approval before any paper order.
        </p>

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

      <SafetyActionsCard
        busy={busy}
        marketOpen={marketOpen}
        positions={positions}
        panicActive={panic}
        onAction={onAction}
      />
    </div>
  );
}
