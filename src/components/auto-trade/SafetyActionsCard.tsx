/**
 * Destructive / safety actions — visually separate from ordinary controls.
 * Emergency Stop never closes positions; Close All is deliberate liquidation.
 */

"use client";

import { useState } from "react";
import { ConfirmActionModal } from "@/components/ui/ConfirmActionModal";
import { useToast } from "@/components/ui/Toast";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";

export type SafetyPositionSummary = {
  symbol: string;
  qty: number;
  marketValue: number | null;
  unrealizedPl: number | null;
};

type ActionResult = { ok: boolean; error?: string; message?: string };

type Props = {
  busy: boolean;
  marketOpen: boolean | null | undefined;
  positions: SafetyPositionSummary[];
  panicActive: boolean;
  onAction: (path: string, body?: object) => Promise<ActionResult>;
};

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function SafetyActionsCard({
  busy,
  marketOpen,
  positions,
  panicActive,
  onAction,
}: Props) {
  const { pushToast } = useToast();
  const [modal, setModal] = useState<"closeAll" | "emergency" | null>(null);
  const [typedClose, setTypedClose] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const submitting = busy || modalBusy;
  const marketValue = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const unrealized = positions.reduce((s, p) => s + (p.unrealizedPl ?? 0), 0);
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
      aria-label="Safety Actions"
      className="rounded-[var(--radius)] border border-red-500/25 bg-red-950/20 p-4 shadow-sm shadow-black/20"
    >
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <h2 className="text-sm font-semibold text-red-100">Safety Actions</h2>
        <AutoTradeInfoTip text="Emergency Stop and Close All Positions are separate. Emergency Stop preserves open positions." />
      </div>
      <p className="mb-3 text-xs text-red-100/70">
        Separate from Emergency Stop: Close All Positions deliberately liquidates
        paper positions. Emergency Stop blocks new activity and preserves open
        positions.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={submitting || panicActive}
          title={
            panicActive
              ? "Emergency stop already active"
              : "Disable execution + auto, pause engine, cancel pending entries, keep positions"
          }
          onClick={() => {
            setModalError(null);
            setModal("emergency");
          }}
          className="ui-btn min-h-11 border border-red-500/60 bg-red-950 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-900 disabled:opacity-50"
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
          className="ui-btn min-h-11 border border-zinc-500/80 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200 opacity-90 hover:bg-zinc-900 disabled:opacity-50"
        >
          {submitting ? "…" : "Close All Positions"}
        </button>
      </div>

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
          <li>Symbols: {symbols.length > 0 ? symbols.join(", ") : "None"}</li>
          <li>Estimated market value: {fmtUsd(marketValue)}</li>
          <li>Unrealized P/L: {fmtUsd(unrealized)}</li>
          <li>
            Market:{" "}
            {marketOpen === true
              ? "Open"
              : marketOpen === false
                ? "Closed"
                : "Unavailable"}
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
          <li>Emergency Stop does not close open positions</li>
        </ul>
      </ConfirmActionModal>
    </section>
  );
}
