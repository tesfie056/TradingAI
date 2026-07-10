/**
 * Dedicated Auto Trade Controls — always visible, backend is source of truth.
 * Uses in-app ConfirmActionModal — never window.confirm/alert/prompt.
 */

"use client";

import { useState } from "react";
import type { EngineControlSnapshot } from "@/lib/auto-trade/runtime-settings/types";
import type { AutoTradeRuntimeSettings } from "@/lib/auto-trade/runtime-settings/types";
import { engineStateLabel } from "@/lib/auto-trade/runtime-settings/engine-state";
import { ConfirmActionModal } from "@/components/ui/ConfirmActionModal";
import { useToast } from "@/components/ui/Toast";

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
  onAction: (path: string, body?: object) => Promise<ActionResult>;
  onOpenSettings: () => void;
};

type ModalKind =
  | "closeAll"
  | "emergency"
  | "enableExecution"
  | "enableAuto"
  | null;

function StatePill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
        : tone === "bad"
          ? "border-red-500/40 bg-red-500/10 text-red-100"
          : "border-zinc-600 bg-zinc-900 text-zinc-200";
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

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
  onAction,
  onOpenSettings,
}: Props) {
  const { pushToast } = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [typedClose, setTypedClose] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const executionOn = engine?.executionEnabled ?? false;
  const autoOn = engine?.autoTradingEnabled ?? false;
  const kill = engine?.killSwitchActive ?? false;
  const panic = engine?.panicStopActive ?? false;
  const paused =
    kill ||
    panic ||
    engine?.engineState === "PAUSED" ||
    engine?.engineState === "EMERGENCY_STOPPED" ||
    !engine?.canScan;
  const engineRunning =
    !kill &&
    !panic &&
    Boolean(engine?.canScan) &&
    engine?.engineState !== "PAUSED" &&
    engine?.engineState !== "EMERGENCY_STOPPED";

  const disableReason = (engine?.blockingReasons ?? [])[0] ?? null;
  const submitting = busy || modalBusy;

  const marketValue = positions.reduce(
    (s, p) => s + (p.marketValue ?? 0),
    0,
  );
  const unrealized = positions.reduce(
    (s, p) => s + (p.unrealizedPl ?? 0),
    0,
  );
  const symbols = positions.map((p) => p.symbol);

  function closeModal() {
    if (modalBusy) return;
    setModal(null);
    setTypedClose("");
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
      setTypedClose("");
      setModalError(null);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setModalBusy(false);
    }
  }

  return (
    <section
      aria-label="Auto Trade Controls"
      className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-100">
          Auto Trade Controls
        </h2>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Trading Settings…
        </button>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <StatePill
          label="Execution"
          value={executionOn ? "ON" : "OFF"}
          tone={executionOn ? "warn" : "neutral"}
        />
        <StatePill
          label="Auto Trading"
          value={autoOn ? "ON" : "OFF"}
          tone={autoOn ? "ok" : "neutral"}
        />
        <StatePill
          label="Engine"
          value={
            engine?.engineState
              ? engineStateLabel(engine.engineState)
              : paused
                ? "Paused"
                : "—"
          }
          tone={panic ? "bad" : paused ? "warn" : "ok"}
        />
        <StatePill
          label="Kill Switch"
          value={kill || panic ? "Active" : "Inactive"}
          tone={kill || panic ? "bad" : "ok"}
        />
        <StatePill
          label="Orders"
          value={engine?.canSubmitOrders ? "Allowed*" : "Blocked"}
          tone={engine?.canSubmitOrders ? "ok" : "warn"}
        />
      </div>
      <p className="mb-3 text-[11px] text-zinc-500">
        *Orders still require risk approval. Live trading is always blocked.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={submitting || panic}
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
                const res = await onAction(
                  "/api/auto-trade/execution/disable",
                );
                if (res.ok) pushToast("Execution disabled", "warn");
                else pushToast(res.error ?? "Action failed", "bad");
              })();
              return;
            }
            setModalError(null);
            setModal("enableExecution");
          }}
          className={`min-w-[9.5rem] rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
            executionOn
              ? "bg-amber-700 text-white hover:bg-amber-600"
              : "border border-zinc-500 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
          }`}
        >
          {submitting ? "…" : `Execution: ${executionOn ? "ON" : "OFF"}`}
        </button>

        <button
          type="button"
          disabled={submitting || panic}
          title={
            panic
              ? "Clear emergency stop before changing auto trading"
              : autoOn
                ? "Turn OFF — scan may continue, no auto submits"
                : "Turn ON — qualified proposals may go through risk + execution"
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
            setModalError(null);
            setModal("enableAuto");
          }}
          className={`min-w-[10.5rem] rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
            autoOn
              ? "bg-emerald-700 text-white hover:bg-emerald-600"
              : "border border-zinc-500 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
          }`}
        >
          {submitting ? "…" : `Auto Trading: ${autoOn ? "ON" : "OFF"}`}
        </button>

        {engineRunning ? (
          <button
            type="button"
            disabled={submitting || panic}
            title={
              panic
                ? "Clear emergency stop first"
                : "Pause engine — stop new scans and proposals"
            }
            onClick={() => {
              void (async () => {
                const res = await onAction("/api/auto-trade/pause");
                if (res.ok) pushToast("Engine paused", "warn");
                else pushToast(res.error ?? "Action failed", "bad");
              })();
            }}
            className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {submitting ? "…" : "Pause Engine"}
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting || panic}
            title={
              panic
                ? "Clear emergency stop before resuming"
                : "Resume engine — restart scanning (does not enable Execution/Auto)"
            }
            onClick={() => {
              void (async () => {
                const res = await onAction("/api/auto-trade/resume");
                if (res.ok) pushToast("Engine resumed", "ok");
                else pushToast(res.error ?? "Action failed", "bad");
              })();
            }}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? "…" : "Resume Engine"}
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
            className="rounded-md border border-amber-500/50 bg-amber-950 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-900 disabled:opacity-50"
          >
            {submitting
              ? "…"
              : panic
                ? "Clear Emergency Stop"
                : "Clear Kill Switch"}
          </button>
        )}

        <button
          type="button"
          disabled={submitting || panic}
          title={
            panic
              ? "Emergency stop already active"
              : "Disable execution + auto, pause engine, cancel pending entries, keep positions"
          }
          onClick={() => {
            setModalError(null);
            setModal("emergency");
          }}
          className="rounded-md border border-red-500/60 bg-red-950 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-900 disabled:opacity-50"
        >
          {submitting ? "…" : "Emergency Stop"}
        </button>

        <button
          type="button"
          disabled={submitting}
          title="Liquidate all open paper positions. Separate from Emergency Stop."
          onClick={() => {
            setTypedClose("");
            setModalError(null);
            setModal("closeAll");
          }}
          className="rounded-md border border-zinc-500 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {submitting ? "…" : "Close All Positions"}
        </button>
      </div>

      {(engine?.blockingReasons?.length ?? 0) > 0 ? (
        <ul className="mt-3 space-y-0.5 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {engine!.blockingReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : disableReason ? (
        <p className="mt-3 text-xs text-zinc-500">{disableReason}</p>
      ) : null}

      {feedback ? (
        <p className="mt-2 text-xs text-emerald-300" role="status">
          {feedback}
        </p>
      ) : null}

      <ConfirmActionModal
        open={modal === "closeAll"}
        title="Close all paper positions?"
        description="This will submit orders to liquidate every currently open paper position."
        warning="This action is separate from Emergency Stop. Emergency Stop blocks new orders but preserves open positions."
        confirmLabel="Close All Positions"
        cancelLabel="Keep Positions Open"
        danger
        loading={modalBusy}
        error={modalError}
        requireTypedText="CLOSE ALL"
        typedValue={typedClose}
        onTypedValueChange={setTypedClose}
        allowBackdropClose={false}
        onCancel={closeModal}
        onConfirm={() =>
          void runModalAction(
            "/api/auto-trade/close-all",
            { confirm: true },
            "Close All submitted",
            "warn",
          )
        }
      >
        <ul className="space-y-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
          <li>Open positions: {positions.length}</li>
          <li>
            Symbols:{" "}
            {symbols.length > 0 ? symbols.join(", ") : "None"}
          </li>
          <li>Estimated market value: {fmtUsd(marketValue)}</li>
          <li>Unrealized P/L: {fmtUsd(unrealized)}</li>
          <li>
            Market:{" "}
            {marketOpen == null
              ? "Unknown"
              : marketOpen
                ? "Open"
                : "Closed"}
          </li>
        </ul>
      </ConfirmActionModal>

      <ConfirmActionModal
        open={modal === "emergency"}
        title="Activate Emergency Stop?"
        description="This will immediately stop new automated activity."
        warning="Existing open positions will remain open. Use Close All Positions separately if you want to liquidate."
        confirmLabel="Activate Emergency Stop"
        cancelLabel="Cancel"
        danger
        loading={modalBusy}
        error={modalError}
        allowBackdropClose={false}
        onCancel={closeModal}
        onConfirm={() =>
          void runModalAction(
            "/api/auto-trade/emergency-stop",
            undefined,
            "Emergency Stop activated",
            "bad",
          )
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">
          <li>Execution will be turned OFF</li>
          <li>Auto Trading will be turned OFF</li>
          <li>The engine will be paused</li>
          <li>Pending entry orders will be canceled</li>
          <li>Existing open positions will remain open</li>
        </ul>
      </ConfirmActionModal>

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
