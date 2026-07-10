"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { BlockReasonList } from "@/components/ui/BlockReasonList";
import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { fetchJson } from "@/lib/client/fetch-json";
import {
  DEFAULT_UI_SETTINGS,
  loadUiSettings,
  saveUiSettings,
  type UiSettings,
} from "@/lib/client/ui-settings";
import type { AppSettingsView } from "@/lib/settings/view";

export function SettingsView() {
  const [server, setServer] = useState<AppSettingsView | null>(null);
  const [ui, setUi] = useState<UiSettings>(() =>
    typeof window === "undefined" ? DEFAULT_UI_SETTINGS : loadUiSettings(),
  );
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchJson<AppSettingsView>("/api/settings");
        if (cancelled) return;
        setServer(res);
        setUi((prev) => ({
          ...prev,
          watchlistDraft: res.watchlistEnv,
          maxTradeAmount: res.maxTradeAmount,
          maxDailyPaperTrades: res.maxDailyPaperTrades,
          maxSpreadPct: res.maxSpreadAllowed,
          preferExecutionEnabled: false,
        }));
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load settings",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function saveDraft() {
    saveUiSettings({ ...ui, preferExecutionEnabled: false });
    setSavedMsg(
      "UI draft saved locally. Server safety gates still use .env.local — drafts do not enable live or automatic trading.",
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Paper trading preferences. Live trading and auto-trading stay blocked.
        </p>
      </div>

      <PaperOnlyBanner detail="execution requires ENABLE_PAPER_ORDER_EXECUTION in .env.local" />

      <div className="border border-[var(--border)] bg-[var(--panel)] px-3 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Common block reasons
        </p>
        <BlockReasonList
          reasons={[
            "Market closed",
            "Order execution off",
            "High risk",
            "Stale quote",
            "Wide spread",
          ]}
        />
      </div>

      {error && (
        <div className="border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      <Panel title="Server safety snapshot (read-only)">
        {server ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-[var(--muted)]">
                Order execution
              </dt>
              <dd className="mt-1 font-semibold text-amber-200">
                {server.orderExecutionEnabled ? "ON (paper)" : "OFF"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--muted)]">
                Trading endpoint
              </dt>
              <dd className="mt-1 font-mono text-xs">{server.tradingEndpoint}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--muted)]">
                Live trading
              </dt>
              <dd className="mt-1 text-rose-200">Blocked</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--muted)]">
                Automatic trading
              </dt>
              <dd className="mt-1 text-rose-200">Blocked</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--muted)]">
                Asset class
              </dt>
              <dd className="mt-1">U.S. equities only</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--muted)]">
                Active watchlist
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {server.watchlist.join(", ")}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        )}
      </Panel>

      <Panel title="Safety warnings">
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100/90">
          {(server?.safetyWarnings ?? []).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </Panel>

      <Panel title="UI draft (local only)">
        <p className="mb-3 text-xs text-[var(--muted)]">
          These fields help you draft preferences. Changing them here does{" "}
          <strong>not</strong> override server env gates. Update{" "}
          <code className="font-mono">.env.local</code> and restart the app for
          watchlist / limits / execution to take effect.
        </p>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs uppercase text-[var(--muted)]">
              Watchlist (comma-separated U.S. stocks)
            </span>
            <input
              value={ui.watchlistDraft}
              onChange={(e) =>
                setUi((s) => ({ ...s, watchlistDraft: e.target.value }))
              }
              className="border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Max trade amount ($)
            </span>
            <input
              type="number"
              min={1}
              value={ui.maxTradeAmount}
              onChange={(e) =>
                setUi((s) => ({
                  ...s,
                  maxTradeAmount: Math.max(1, Number(e.target.value) || 1),
                }))
              }
              className="border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
            />
            <span className="text-[10px] text-[var(--muted)]">
              Server: MAX_PAPER_TRADE_NOTIONAL={server?.maxTradeAmount ?? "—"}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Max daily paper trades
            </span>
            <input
              type="number"
              min={1}
              value={ui.maxDailyPaperTrades}
              onChange={(e) =>
                setUi((s) => ({
                  ...s,
                  maxDailyPaperTrades: Math.max(
                    1,
                    Math.floor(Number(e.target.value) || 1),
                  ),
                }))
              }
              className="border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
            />
            <span className="text-[10px] text-[var(--muted)]">
              Server: MAX_DAILY_PAPER_TRADES=
              {server?.maxDailyPaperTrades ?? "—"}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Minimum confidence (draft)
            </span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={ui.minConfidence}
              onChange={(e) =>
                setUi((s) => ({
                  ...s,
                  minConfidence: Math.min(
                    1,
                    Math.max(0, Number(e.target.value) || 0),
                  ),
                }))
              }
              className="border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Max spread allowed
            </span>
            <input
              type="number"
              min={0.001}
              max={0.05}
              step={0.001}
              value={ui.maxSpreadPct}
              onChange={(e) =>
                setUi((s) => ({
                  ...s,
                  maxSpreadPct: Math.max(0.001, Number(e.target.value) || 0.01),
                }))
              }
              className="border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
            />
            <span className="text-[10px] text-[var(--muted)]">
              Server hold threshold:{" "}
              {server
                ? `${(server.maxSpreadAllowed * 100).toFixed(1)}%`
                : "—"}
            </span>
          </label>
        </div>

        <div className="mt-4 border border-[var(--border)] bg-[var(--background)]/40 p-3">
          <p className="text-sm font-semibold text-amber-100">
            Execution toggle
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            This UI cannot turn execution on. Current server state:{" "}
            <strong className="text-amber-200">
              {server?.orderExecutionEnabled ? "ON (paper)" : "OFF"}
            </strong>
            . To enable manual paper submits, set{" "}
            <code className="font-mono">ENABLE_PAPER_ORDER_EXECUTION=true</code>{" "}
            in <code className="font-mono">.env.local</code> and restart. Live
            trading remains blocked.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm opacity-60">
            <input type="checkbox" checked={false} disabled readOnly />
            <span>
              Enable paper order execution (disabled in UI — use .env.local
              only)
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveDraft}
            className="border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-50"
          >
            Save UI draft
          </button>
        </div>
        {savedMsg && (
          <p className="mt-2 text-xs text-emerald-200/90">{savedMsg}</p>
        )}
      </Panel>
    </div>
  );
}
