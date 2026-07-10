"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/client/fetch-json";
import type { AutoTradeRuntimeSettings } from "@/lib/auto-trade/runtime-settings/types";
import { ConfirmActionModal } from "@/components/ui/ConfirmActionModal";
import { useToast } from "@/components/ui/Toast";

type MetaRow = {
  key: string;
  label: string;
  group: string;
  applyMode: string;
  help: string;
};

type WatchlistInfo = {
  source: "runtime" | "paper_soak" | "env_default";
  effective: string[];
  paperSoakActive: boolean;
  note: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial: AutoTradeRuntimeSettings | null;
};

const GROUPS = [
  { id: "risk", title: "Risk" },
  { id: "schedule", title: "Schedule" },
  { id: "universe", title: "Universe" },
  { id: "strategy", title: "Strategy permissions" },
  { id: "locked", title: "Locked (environment)" },
] as const;

type RiskChange = {
  field: string;
  label: string;
  previous: string;
  next: string;
  why: string;
};

function detectRiskIncreases(
  current: AutoTradeRuntimeSettings,
  baseline: AutoTradeRuntimeSettings,
): RiskChange[] {
  const changes: RiskChange[] = [];
  const push = (
    field: string,
    label: string,
    prev: string,
    next: string,
    why: string,
    increased: boolean,
  ) => {
    if (increased) changes.push({ field, label, previous: prev, next, why });
  };

  push(
    "maxRiskPerTradePct",
    "Risk per trade",
    `${(baseline.maxRiskPerTradePct * 100).toFixed(2)}%`,
    `${(current.maxRiskPerTradePct * 100).toFixed(2)}%`,
    "Higher risk per trade increases potential loss on each entry.",
    current.maxRiskPerTradePct > baseline.maxRiskPerTradePct,
  );
  push(
    "maxDailyLossPct",
    "Daily loss limit",
    `${(baseline.maxDailyLossPct * 100).toFixed(2)}%`,
    `${(current.maxDailyLossPct * 100).toFixed(2)}%`,
    "A higher daily loss limit allows larger drawdowns before pausing.",
    current.maxDailyLossPct > baseline.maxDailyLossPct,
  );
  push(
    "maxPositionAllocationPct",
    "Max position allocation",
    `${(baseline.maxPositionAllocationPct * 100).toFixed(2)}%`,
    `${(current.maxPositionAllocationPct * 100).toFixed(2)}%`,
    "Higher allocation concentrates more capital in a single position.",
    current.maxPositionAllocationPct > baseline.maxPositionAllocationPct,
  );
  push(
    "maxOpenPositions",
    "Max open positions",
    String(baseline.maxOpenPositions),
    String(current.maxOpenPositions),
    "More concurrent positions increases aggregate exposure.",
    current.maxOpenPositions > baseline.maxOpenPositions,
  );
  push(
    "maxTradesPerDay",
    "Max trades per day",
    String(baseline.maxTradesPerDay),
    String(current.maxTradesPerDay),
    "More daily trades increases turnover and cumulative risk.",
    current.maxTradesPerDay > baseline.maxTradesPerDay,
  );
  push(
    "longOnly",
    "Long-only / short selling",
    baseline.longOnly ? "Long only" : "Shorts allowed",
    current.longOnly ? "Long only" : "Shorts allowed",
    "Enabling short selling increases directional and borrow risk.",
    baseline.longOnly === true && current.longOnly === false,
  );
  push(
    "openEntryDelayMinutes",
    "Open-entry delay",
    `${baseline.openEntryDelayMinutes} min`,
    `${current.openEntryDelayMinutes} min`,
    "Reducing the open delay allows entries closer to the volatile open.",
    current.openEntryDelayMinutes < baseline.openEntryDelayMinutes,
  );
  push(
    "eodEntryCutoffMinutes",
    "End-of-day cutoff",
    `${baseline.eodEntryCutoffMinutes} min`,
    `${current.eodEntryCutoffMinutes} min`,
    "Reducing the EOD cutoff allows entries closer to the close.",
    current.eodEntryCutoffMinutes < baseline.eodEntryCutoffMinutes,
  );
  return changes;
}

export function TradingSettingsDrawer({
  open,
  onClose,
  onSaved,
  initial,
}: Props) {
  const { pushToast } = useToast();
  const [draft, setDraft] = useState<AutoTradeRuntimeSettings | null>(initial);
  const [baseline, setBaseline] = useState<AutoTradeRuntimeSettings | null>(
    initial,
  );
  const [watchlistInfo, setWatchlistInfo] = useState<WatchlistInfo | null>(
    null,
  );
  const [meta, setMeta] = useState<MetaRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [pendingRiskChanges, setPendingRiskChanges] = useState<RiskChange[]>(
    [],
  );

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const data = await fetchJson<{
        settings: AutoTradeRuntimeSettings;
        meta: MetaRow[];
        watchlistInfo?: WatchlistInfo;
      }>("/api/auto-trade/settings");
      setDraft(data.settings);
      setBaseline(data.settings);
      setWatchlistInfo(data.watchlistInfo ?? null);
      setMeta(data.meta ?? []);
      setErrors([]);
      setMessage(null);
      setRiskModalOpen(false);
      setResetModalOpen(false);
      setModalError(null);
    })().catch((e) =>
      setErrors([e instanceof Error ? e.message : "Failed to load settings"]),
    );
  }, [open, initial?.configVersion]);

  const dirty = useMemo(() => {
    if (!draft || !baseline) return false;
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  }, [draft, baseline]);

  if (!open || !draft) return null;

  const current = draft;

  function setField<K extends keyof AutoTradeRuntimeSettings>(
    key: K,
    value: AutoTradeRuntimeSettings[K],
  ) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function persistSave() {
    if (!current || !baseline || busy) return false;
    setBusy(true);
    setErrors([]);
    setMessage(null);
    setModalError(null);
    try {
      const {
        configVersion: _c,
        updatedAt: _u,
        paperOnly: _p,
        liveTradingAllowed: _l,
        riskEngineRequired: _r,
        bracketsRequired: _b,
        ...patch
      } = current;
      void _c;
      void _u;
      void _p;
      void _l;
      void _r;
      void _b;
      const res = await fetchJson<{
        ok: boolean;
        errors?: string[];
        changedFields?: string[];
        settings?: AutoTradeRuntimeSettings;
        watchlistInfo?: WatchlistInfo;
      }>("/api/auto-trade/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch, reason: "ui_trading_settings" }),
      });
      if (res.ok === false && res.errors?.length) {
        const msg = res.errors.join("; ");
        setErrors(res.errors);
        setModalError(msg);
        return false;
      }
      if (res.settings) {
        setDraft(res.settings);
        setBaseline(res.settings);
      }
      if (res.watchlistInfo) setWatchlistInfo(res.watchlistInfo);
      const okMsg = res.changedFields?.length
        ? `Saved (${res.changedFields.length} field(s)). Applied immediately.`
        : "No changes.";
      setMessage(okMsg);
      pushToast(okMsg, "ok");
      onSaved();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setErrors([msg]);
      setModalError(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!current || !baseline || busy) return;
    const riskChanges = detectRiskIncreases(current, baseline);
    if (riskChanges.length > 0) {
      setPendingRiskChanges(riskChanges);
      setModalError(null);
      setRiskModalOpen(true);
      return;
    }
    await persistSave();
  }

  async function confirmRiskSave() {
    const ok = await persistSave();
    if (ok) {
      setRiskModalOpen(false);
      setPendingRiskChanges([]);
    }
  }

  async function confirmReset() {
    if (busy) return;
    setBusy(true);
    setModalError(null);
    try {
      await fetchJson("/api/auto-trade/settings/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      setMessage("Defaults restored.");
      pushToast("Defaults restored", "warn");
      setResetModalOpen(false);
      onSaved();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  function fieldMeta(key: string) {
    return meta.find((m) => m.key === key);
  }

  function renderNumber(
    key: keyof AutoTradeRuntimeSettings,
    step = 1,
    opts?: { asSecondsFromMs?: boolean },
  ) {
    const m = fieldMeta(String(key));
    if (!m || m.applyMode === "locked") return null;
    const raw = current[key];
    const display =
      opts?.asSecondsFromMs && typeof raw === "number"
        ? Math.round(raw / 1000)
        : raw;
    return (
      <label key={String(key)} className="block text-sm text-zinc-300">
        <span className="flex items-center gap-1">
          {m.label}
          <span className="text-xs text-zinc-500" title={m.help}>
            ⓘ
          </span>
          <span className="ml-auto text-[10px] uppercase text-emerald-500/80">
            Applied immediately
          </span>
        </span>
        <input
          type="number"
          step={step}
          value={typeof display === "number" ? display : 0}
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.target.value);
            const stored = opts?.asSecondsFromMs ? n * 1000 : n;
            setField(
              key,
              stored as AutoTradeRuntimeSettings[typeof key],
            );
          }}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100"
        />
      </label>
    );
  }

  function renderBool(key: keyof AutoTradeRuntimeSettings) {
    const m = fieldMeta(String(key));
    if (!m || m.applyMode === "locked") return null;
    const val = Boolean(current[key]);
    return (
      <label
        key={String(key)}
        className="flex items-center gap-2 text-sm text-zinc-300"
      >
        <input
          type="checkbox"
          checked={val}
          disabled={busy || (key === "longOnly" && val)}
          onChange={(e) => {
            if (key === "longOnly" && !e.target.checked) {
              setErrors(["Short selling cannot be enabled in this stage"]);
              return;
            }
            setField(
              key,
              e.target.checked as AutoTradeRuntimeSettings[typeof key],
            );
          }}
        />
        {m.label}
        <span className="text-xs text-zinc-500" title={m.help}>
          ⓘ
        </span>
        <span className="ml-auto text-[10px] uppercase text-emerald-500/80">
          Applied immediately
        </span>
      </label>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Close settings"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-zinc-700 bg-zinc-900 shadow-xl">
        <header className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              Trading Settings
            </h2>
            <p className="text-xs text-zinc-500">
              v{current.configVersion} · runtime · paper only
              {dirty ? " · unsaved changes" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-600 px-2 py-1 text-sm text-zinc-300"
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          {GROUPS.map((g) => (
            <section key={g.id}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {g.title}
              </h3>
              {g.id === "locked" ? (
                <ul className="space-y-2 text-sm text-zinc-400">
                  <li>Live trading — Locked (always blocked)</li>
                  <li>Risk engine — Locked (always required)</li>
                  <li>Bracket protection — Locked (always required)</li>
                  <li>Broker credentials — Restart required / env only</li>
                </ul>
              ) : null}
              {g.id === "risk" ? (
                <div className="space-y-3">
                  {renderNumber("maxOpenPositions")}
                  {renderNumber("maxTradesPerDay")}
                  {renderNumber("maxRiskPerTradePct", 0.05)}
                  {renderNumber("maxPositionAllocationPct", 0.5)}
                  {renderNumber("maxDailyLossPct", 0.1)}
                  {renderNumber("consecutiveLossPause")}
                </div>
              ) : null}
              {g.id === "schedule" ? (
                <div className="space-y-3">
                  {renderBool("regularHoursOnly")}
                  {renderNumber("openEntryDelayMinutes")}
                  {renderNumber("eodEntryCutoffMinutes")}
                  {renderNumber("scanIntervalOpenMs", 1, {
                    asSecondsFromMs: true,
                  })}
                  {renderNumber("scanIntervalClosedMs", 1, {
                    asSecondsFromMs: true,
                  })}
                </div>
              ) : null}
              {g.id === "universe" ? (
                <div className="space-y-3">
                  {watchlistInfo ? (
                    <div className="rounded border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-400">
                      <p>
                        Source:{" "}
                        <strong className="text-zinc-200">
                          {watchlistInfo.source === "paper_soak"
                            ? "paper-soak profile"
                            : watchlistInfo.source === "runtime"
                              ? "runtime"
                              : "environment default"}
                        </strong>
                        {" · "}
                        {watchlistInfo.effective.length} symbols
                      </p>
                      <p className="mt-1">{watchlistInfo.note}</p>
                    </div>
                  ) : null}
                  <label className="block text-sm text-zinc-300">
                    <span className="flex items-center gap-1">
                      Effective watchlist
                      <span className="ml-auto text-[10px] uppercase text-emerald-500/80">
                        Applied immediately
                      </span>
                    </span>
                    <textarea
                      value={current.watchlist.join(",")}
                      disabled={busy}
                      rows={5}
                      onChange={(e) =>
                        setField(
                          "watchlist",
                          e.target.value
                            .split(",")
                            .map((s) => s.trim().toUpperCase())
                            .filter(Boolean),
                        )
                      }
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </label>
                  {renderNumber("minPrice", 0.5)}
                  {renderNumber("maxPrice", 0.5)}
                  {renderNumber("minAvgDailyVolume", 1000)}
                  {renderNumber("maxSpreadPercent", 0.1)}
                  {renderBool("excludeLeveragedInverseEtfs")}
                  {renderNumber("minEligibleSymbols")}
                </div>
              ) : null}
              {g.id === "strategy" ? (
                <div className="space-y-3">
                  {renderBool("longOnly")}
                  {renderBool("paperSoakProfile")}
                  {renderBool("allowSellAuto")}
                  {renderNumber("minConfidence", 0.01)}
                  {renderNumber("cooldownMinutes")}
                </div>
              ) : null}
            </section>
          ))}
        </div>

        <footer className="space-y-2 border-t border-zinc-700 px-4 py-3">
          {errors.length > 0 ? (
            <ul className="text-sm text-red-300">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => void save()}
              className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setModalError(null);
                setResetModalOpen(true);
              }}
              className="rounded border border-zinc-600 px-3 py-2 text-sm text-zinc-200"
            >
              Restore defaults
            </button>
          </div>
        </footer>
      </aside>

      <ConfirmActionModal
        open={riskModalOpen}
        title="Apply risk increase?"
        description="One or more settings increase risk exposure. Review the changes before applying."
        warning="These changes take effect immediately after confirmation."
        confirmLabel="Apply Risk Increase"
        cancelLabel="Review Settings"
        danger
        loading={busy}
        error={modalError}
        allowBackdropClose={false}
        onCancel={() => {
          if (busy) return;
          setRiskModalOpen(false);
          setModalError(null);
        }}
        onConfirm={() => void confirmRiskSave()}
      >
        <ul className="space-y-2 text-sm text-zinc-300">
          {pendingRiskChanges.map((c) => (
            <li
              key={c.field}
              className="rounded border border-zinc-700 bg-zinc-950/70 px-3 py-2"
            >
              <p className="font-medium text-zinc-100">{c.label}</p>
              <p>
                {c.previous} → {c.next}
              </p>
              <p className="mt-1 text-xs text-amber-200">{c.why}</p>
            </li>
          ))}
        </ul>
      </ConfirmActionModal>

      <ConfirmActionModal
        open={resetModalOpen}
        title="Restore safe defaults?"
        description="Runtime settings will be reset from environment defaults. Paper-only and live-trading locks stay in place."
        confirmLabel="Restore Defaults"
        cancelLabel="Cancel"
        danger
        loading={busy}
        error={modalError}
        allowBackdropClose={false}
        onCancel={() => {
          if (busy) return;
          setResetModalOpen(false);
          setModalError(null);
        }}
        onConfirm={() => void confirmReset()}
      />
    </div>
  );
}
