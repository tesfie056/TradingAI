"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { BlockReasonList } from "@/components/ui/BlockReasonList";
import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { SafetyStrip } from "@/components/ui/SafetyStrip";
import { useUiChrome } from "@/components/layout/UiChromeContext";
import { fetchJson } from "@/lib/client/fetch-json";
import {
  DEFAULT_UI_SETTINGS,
  loadUiSettings,
  saveUiSettings,
  type UiSettings,
} from "@/lib/client/ui-settings";
import { aiStatusDisplayLabel } from "@/lib/client/block-reasons";
import type { AppSettingsView } from "@/lib/settings/view";
import type { AiHealthPayload } from "@/lib/dashboard-types";

export function SettingsView() {
  const { setViewMode } = useUiChrome();
  const [server, setServer] = useState<AppSettingsView | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealthPayload | null>(null);
  const [ui, setUi] = useState<UiSettings>(() =>
    typeof window === "undefined" ? DEFAULT_UI_SETTINGS : loadUiSettings(),
  );
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [res, health] = await Promise.all([
          fetchJson<AppSettingsView>("/api/settings"),
          fetchJson<AiHealthPayload>("/api/ai/health").catch(() => null),
        ]);
        if (cancelled) return;
        setServer(res);
        setAiHealth(health);
        setUi((prev) => ({
          ...prev,
          ...loadUiSettings(),
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
    setViewMode(ui.viewMode);
    setSavedMsg(
      "UI preferences saved locally. Server safety gates still use .env.local — drafts do not enable live or automatic trading.",
    );
  }

  const inputClass =
    "rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-base";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="h1">Settings</h1>
        <p className="mt-2 text-base text-[var(--muted)]">
          Local preferences for the paper control room. Live and auto-trading
          stay blocked.
        </p>
      </div>

      <SafetyStrip
        orderExecutionEnabled={server?.orderExecutionEnabled ?? false}
      />

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
          layout="inline"
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
                AI provider
              </dt>
              <dd className="mt-1 font-semibold">
                {aiStatusDisplayLabel(aiHealth?.statusLabel)}
                {aiHealth?.ollama.model
                  ? ` · ${aiHealth.ollama.model}`
                  : ""}
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

      <Panel title="UI preferences (local only)">
        <p className="mb-3 text-xs text-[var(--muted)]">
          These fields save to your browser. They do <strong>not</strong>{" "}
          override server env gates. Update{" "}
          <code className="font-mono">.env.local</code> and restart for
          watchlist / limits / execution to take effect on the server.
        </p>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs uppercase text-[var(--muted)]">
              Watchlist draft (comma-separated U.S. stocks)
            </span>
            <input
              value={ui.watchlistDraft}
              onChange={(e) =>
                setUi((s) => ({ ...s, watchlistDraft: e.target.value }))
              }
              className={`${inputClass} font-mono text-xs`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Default quantity
            </span>
            <input
              type="number"
              min={1}
              value={ui.defaultQuantity}
              onChange={(e) =>
                setUi((s) => ({
                  ...s,
                  defaultQuantity: Math.max(
                    1,
                    Math.floor(Number(e.target.value) || 1),
                  ),
                }))
              }
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Minimum confidence (display filter draft)
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
              className={inputClass}
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
              className={inputClass}
            />
            <span className="text-[10px] text-[var(--muted)]">
              Server: MAX_PAPER_TRADE_NOTIONAL={server?.maxTradeAmount ?? "—"}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Max spread (draft)
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
              className={inputClass}
            />
            <span className="text-[10px] text-[var(--muted)]">
              Server hold threshold:{" "}
              {server
                ? `${(server.maxSpreadAllowed * 100).toFixed(1)}%`
                : "—"}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Max daily paper trades (draft)
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
              className={inputClass}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-2 text-base sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="radio"
              name="viewMode"
              checked={ui.viewMode === "simple"}
              onChange={() => {
                setUi((s) => ({ ...s, viewMode: "simple" }));
                setViewMode("simple");
              }}
            />
            Simple view
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="radio"
              name="viewMode"
              checked={ui.viewMode === "advanced"}
              onChange={() => {
                setUi((s) => ({ ...s, viewMode: "advanced" }));
                setViewMode("advanced");
              }}
            />
            Advanced view
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="checkbox"
              checked={ui.compactScores}
              onChange={(e) =>
                setUi((s) => ({ ...s, compactScores: e.target.checked }))
              }
            />
            Compact score badges
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="checkbox"
              checked={ui.showNewsColumn}
              onChange={(e) =>
                setUi((s) => ({ ...s, showNewsColumn: e.target.checked }))
              }
            />
            Prefer news column
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="checkbox"
              checked={ui.showTrendVolume}
              onChange={(e) =>
                setUi((s) => ({ ...s, showTrendVolume: e.target.checked }))
              }
            />
            Prefer trend / volume
          </label>
        </div>

        <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]/40 p-4">
          <p className="text-base font-semibold text-amber-100">
            Execution toggle
          </p>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            This UI cannot turn execution on. Current server state:{" "}
            <strong className="text-amber-200">
              {server?.orderExecutionEnabled ? "ON (paper)" : "OFF"}
            </strong>
            . Use{" "}
            <code className="font-mono">ENABLE_PAPER_ORDER_EXECUTION=true</code>{" "}
            in <code className="font-mono">.env.local</code> only. Live trading
            remains blocked.
          </p>
          <label className="mt-3 flex items-start gap-2 text-base opacity-60">
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
            className="ui-btn border border-amber-500/50 bg-amber-500/15 text-amber-50"
          >
            Save UI preferences
          </button>
          <button
            type="button"
            onClick={() => {
              setUi({ ...DEFAULT_UI_SETTINGS });
              saveUiSettings({ ...DEFAULT_UI_SETTINGS });
              setViewMode(DEFAULT_UI_SETTINGS.viewMode);
              setSavedMsg("Reset to defaults (local only).");
            }}
            className="ui-btn border border-[var(--border)] text-[var(--muted)]"
          >
            Reset defaults
          </button>
        </div>
        {savedMsg && (
          <p className="mt-2 text-sm text-emerald-200/90">{savedMsg}</p>
        )}
      </Panel>
    </div>
  );
}
