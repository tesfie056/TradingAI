"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { Panel } from "@/components/ui/Panel";
import { StatusDot } from "@/components/ui/SafetyStrip";
import { useUiChrome } from "@/components/layout/UiChromeContext";
import { fetchJson } from "@/lib/client/fetch-json";
import {
  DEFAULT_UI_SETTINGS,
  loadUiSettings,
  parseWatchlistDraft,
  saveUiSettings,
  type UiSettings,
} from "@/lib/client/ui-settings";
import { aiStatusDisplayLabel } from "@/lib/client/block-reasons";
import { isBlockedNonStockSymbol } from "@/lib/stocks/universe";
import type { AppSettingsView } from "@/lib/settings/view";
import type { AiHealthPayload, NewsPayload, SafetyPayload } from "@/lib/dashboard-types";

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function SettingsView() {
  const { setViewMode } = useUiChrome();
  const [server, setServer] = useState<AppSettingsView | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealthPayload | null>(null);
  const [safety, setSafety] = useState<SafetyPayload | null>(null);
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [ui, setUi] = useState<UiSettings>(DEFAULT_UI_SETTINGS);
  const [symbolInput, setSymbolInput] = useState("");
  const [symbolBusy, setSymbolBusy] = useState(false);
  const [symbolMsg, setSymbolMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const boot = window.setTimeout(() => {
      setUi(loadUiSettings());
    }, 0);
    return () => window.clearTimeout(boot);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = window.setTimeout(() => {
      void (async () => {
        try {
          const [res, health, safetyRes, newsRes] = await Promise.all([
            fetchJson<AppSettingsView>("/api/settings"),
            fetchJson<AiHealthPayload>("/api/ai/health").catch(() => null),
            fetchJson<SafetyPayload>("/api/safety").catch(() => null),
            fetchJson<NewsPayload>("/api/news").catch(() => null),
          ]);
          if (cancelled) return;
          setServer(res);
          setAiHealth(health);
          setSafety(safetyRes);
          setNews(newsRes);
        } catch (err) {
          if (!cancelled) {
            setError(
              err instanceof Error ? err.message : "Failed to load settings",
            );
          }
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
    };
  }, []);

  const localSymbols = useMemo(
    () => parseWatchlistDraft(ui.watchlistDraft),
    [ui.watchlistDraft],
  );

  function patchUi(partial: Partial<UiSettings>) {
    setUi((s) => ({ ...s, ...partial, preferExecutionEnabled: false }));
    setSavedMsg(null);
  }

  function saveDraft() {
    const next = {
      ...ui,
      preferExecutionEnabled: false,
      watchlistDraft: localSymbols.join(","),
    };
    saveUiSettings(next);
    setUi(next);
    setViewMode(next.viewMode);
    setSavedMsg(
      "Preferences saved locally. Backend safety still decides final eligibility. Restart may be required for server env changes.",
    );
  }

  function resetDefaults() {
    const next = { ...DEFAULT_UI_SETTINGS };
    setUi(next);
    saveUiSettings(next);
    setViewMode(next.viewMode);
    setSymbolInput("");
    setSymbolMsg(null);
    setSavedMsg("Reset to defaults (local preferences only).");
  }

  async function addSymbol() {
    const raw = symbolInput.trim().toUpperCase();
    setSymbolMsg(null);
    if (!raw) return;
    if (!SYMBOL_RE.test(raw) || isBlockedNonStockSymbol(raw)) {
      setSymbolMsg("Enter a valid U.S. stock ticker (stocks only — no crypto).");
      return;
    }
    if (localSymbols.includes(raw)) {
      setSymbolMsg(`${raw} is already in your local watchlist preferences.`);
      return;
    }
    setSymbolBusy(true);
    try {
      const res = await fetchJson<{
        ok: boolean;
        error?: string;
        symbol?: string;
        message?: string;
      }>(`/api/stocks/lookup?symbol=${encodeURIComponent(raw)}`);
      if (!res.ok || !res.symbol) {
        setSymbolMsg(res.error ?? `Could not validate ${raw}`);
        return;
      }
      const nextList = [...localSymbols, res.symbol];
      patchUi({ watchlistDraft: nextList.join(",") });
      setSymbolInput("");
      setSymbolMsg(
        res.message ??
          `${res.symbol} added to local preferences (not the full Alpaca universe).`,
      );
    } catch (err) {
      setSymbolMsg(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setSymbolBusy(false);
    }
  }

  function removeSymbol(sym: string) {
    const next = localSymbols.filter((s) => s !== sym);
    patchUi({ watchlistDraft: next.join(",") });
    setSymbolMsg(`${sym} removed from local preferences (save to keep).`);
  }

  const inputClass =
    "rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-base";

  const alpacaStatus = safety?.ok ? "Connected" : "Not connected";
  const finnhubStatus = (() => {
    const active = news?.status?.activeProvider ?? server?.newsProviderConfigured;
    if (active === "finnhub") return "Active";
    if (news?.status?.usedFallback) return "Fallback";
    if (server?.newsProviderConfigured === "finnhub") return "Configured";
    if (active === "mock" || server?.newsProviderConfigured === "mock")
      return "Fallback (mock)";
    return "None";
  })();
  const ollamaStatus = (() => {
    if (aiHealth?.statusLabel === "connected") return "Connected";
    if (aiHealth?.statusLabel === "fallback") return "Fallback";
    if (server?.aiProviderConfigured === "ollama") return "Fallback";
    return "Heuristic";
  })();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Manage local trading desk preferences. Real safety gates are still controlled by server environment variables."
      />

      <SafetyBanner
        orderExecutionEnabled={server?.orderExecutionEnabled ?? false}
        detail="stocks · paper only · secrets stay in .env.local"
      />

      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {/* Watchlist preferences */}
      <Panel title="Watchlist preferences">
        <p className="mb-3 text-sm text-[var(--muted)]">
          Only your configured local watchlist appears here. This does not load
          the full Alpaca stock universe. Server watchlist still comes from{" "}
          <code className="font-mono">WATCHLIST</code> in{" "}
          <code className="font-mono">.env.local</code>.
        </p>

        <div className="flex flex-wrap gap-2">
          {localSymbols.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No local symbols yet.</p>
          ) : (
            localSymbols.map((sym) => (
              <span
                key={sym}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/50 px-2.5 py-1.5 text-sm font-semibold"
              >
                {sym}
                <button
                  type="button"
                  onClick={() => removeSymbol(sym)}
                  className="text-xs font-medium text-rose-200/90 underline-offset-2 hover:underline"
                >
                  Remove
                </button>
              </span>
            ))
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm text-[var(--muted)]">Add stock symbol</span>
            <input
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              placeholder="e.g. TSLA"
              className={`${inputClass} font-mono`}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addSymbol();
                }
              }}
            />
          </label>
          <button
            type="button"
            disabled={symbolBusy || !symbolInput.trim()}
            onClick={() => void addSymbol()}
            className="ui-btn border border-[var(--border)] disabled:opacity-50"
          >
            {symbolBusy ? "Validating…" : "Validate & add"}
          </button>
        </div>
        {symbolMsg ? (
          <p className="mt-2 text-sm text-amber-100/90">{symbolMsg}</p>
        ) : null}

        {server ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Server env watchlist (read-only):{" "}
            <span className="font-mono">{server.watchlist.join(", ")}</span>
          </p>
        ) : null}
      </Panel>

      {/* Display preferences */}
      <Panel title="Display preferences">
        <div className="grid gap-2 text-base sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="radio"
              name="viewMode"
              checked={ui.viewMode === "simple"}
              onChange={() => {
                patchUi({ viewMode: "simple" });
                setViewMode("simple");
              }}
            />
            Simple View
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="radio"
              name="viewMode"
              checked={ui.viewMode === "advanced"}
              onChange={() => {
                patchUi({ viewMode: "advanced" });
                setViewMode("advanced");
              }}
            />
            Advanced View
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="radio"
              name="cardDensity"
              checked={ui.cardDensity === "compact"}
              onChange={() => patchUi({ cardDensity: "compact" })}
            />
            Compact cards
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="radio"
              name="cardDensity"
              checked={ui.cardDensity === "comfortable"}
              onChange={() => patchUi({ cardDensity: "comfortable" })}
            />
            Comfortable cards
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="checkbox"
              checked={ui.showScoreDetails}
              onChange={(e) =>
                patchUi({
                  showScoreDetails: e.target.checked,
                  compactScores: !e.target.checked,
                })
              }
            />
            Show score details
          </label>
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3.5 py-3">
            <input
              type="checkbox"
              checked={ui.showBlockedReasonDetails}
              onChange={(e) =>
                patchUi({ showBlockedReasonDetails: e.target.checked })
              }
            />
            Show blocked reason details
          </label>
        </div>
      </Panel>

      {/* Trading desk preferences */}
      <Panel title="Trading desk preferences">
        <p className="mb-3 text-sm text-[var(--muted)]">
          These are UI/local preferences. Backend safety still decides final
          eligibility.
        </p>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Default quantity
            </span>
            <input
              type="number"
              min={1}
              value={ui.defaultQuantity}
              onChange={(e) =>
                patchUi({
                  defaultQuantity: Math.max(
                    1,
                    Math.floor(Number(e.target.value) || 1),
                  ),
                })
              }
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Default order mode
            </span>
            <select
              value={ui.orderMode}
              onChange={(e) =>
                patchUi({
                  orderMode:
                    e.target.value === "quantity" ? "quantity" : "notional",
                })
              }
              className={inputClass}
            >
              <option value="quantity">Shares (quantity)</option>
              <option value="notional">Dollar amount (notional)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Default dollar amount
            </span>
            <input
              type="number"
              min={1}
              step={0.01}
              value={ui.defaultNotional}
              onChange={(e) =>
                patchUi({
                  defaultNotional: Math.max(1, Number(e.target.value) || 10),
                })
              }
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Minimum confidence for trade preview
            </span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={ui.minConfidence}
              onChange={(e) =>
                patchUi({
                  minConfidence: Math.min(
                    1,
                    Math.max(0, Number(e.target.value) || 0),
                  ),
                })
              }
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Maximum spread allowed
            </span>
            <input
              type="number"
              min={0.001}
              max={0.05}
              step={0.001}
              value={ui.maxSpreadPct}
              onChange={(e) =>
                patchUi({
                  maxSpreadPct: Math.max(0.001, Number(e.target.value) || 0.01),
                })
              }
              className={inputClass}
            />
            <span className="text-xs text-[var(--muted)]">
              Server hold threshold:{" "}
              {server
                ? `${(server.maxSpreadAllowed * 100).toFixed(1)}%`
                : "—"}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Maximum paper notional per trade ($)
            </span>
            <input
              type="number"
              min={1}
              value={ui.maxTradeAmount}
              onChange={(e) =>
                patchUi({
                  maxTradeAmount: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className={inputClass}
            />
            <span className="text-xs text-[var(--muted)]">
              Server: MAX_NOTIONAL_PER_TRADE={server?.maxTradeAmount ?? "—"}
              {server?.smallAccount?.enabled
                ? ` · Small Account Mode ON`
                : ""}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-[var(--muted)]">
              Maximum daily paper trades
            </span>
            <input
              type="number"
              min={1}
              value={ui.maxDailyPaperTrades}
              onChange={(e) =>
                patchUi({
                  maxDailyPaperTrades: Math.max(
                    1,
                    Math.floor(Number(e.target.value) || 1),
                  ),
                })
              }
              className={inputClass}
            />
            <span className="text-xs text-[var(--muted)]">
              Server: MAX_DAILY_PAPER_TRADES=
              {server?.maxDailyPaperTrades ?? "—"}
            </span>
          </label>
          {server?.smallAccount?.enabled ? (
            <>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs uppercase text-[var(--muted)]">
                  Small-account max price ($)
                </span>
                <input
                  type="number"
                  min={1}
                  value={ui.smallAccountMaxPrice}
                  onChange={(e) =>
                    patchUi({
                      smallAccountMaxPrice: Math.max(
                        1,
                        Number(e.target.value) || 50,
                      ),
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase text-[var(--muted)]">
                  Min avg daily volume
                </span>
                <input
                  type="number"
                  min={0}
                  value={ui.smallAccountMinVolume}
                  onChange={(e) =>
                    patchUi({
                      smallAccountMinVolume: Math.max(
                        0,
                        Math.floor(Number(e.target.value) || 0),
                      ),
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase text-[var(--muted)]">
                  Max spread (%)
                </span>
                <input
                  type="number"
                  min={0.01}
                  step={0.05}
                  value={ui.smallAccountMaxSpread}
                  onChange={(e) =>
                    patchUi({
                      smallAccountMaxSpread: Math.max(
                        0.01,
                        Number(e.target.value) || 0.5,
                      ),
                    })
                  }
                  className={inputClass}
                />
              </label>
            </>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs uppercase text-[var(--muted)]">
              Risk level allowed
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="maxRisk"
                checked={ui.maxRiskAllowed === "low"}
                onChange={() => patchUi({ maxRiskAllowed: "low" })}
              />
              Low only
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="maxRisk"
                checked={ui.maxRiskAllowed === "medium"}
                onChange={() => patchUi({ maxRiskAllowed: "medium" })}
              />
              Low / Medium only
            </label>
            <p className="text-xs text-[var(--muted)]">
              High risk remains blocked by backend gates regardless of this
              preference.
            </p>
          </fieldset>
        </div>
      </Panel>

      {/* Provider status — read-only, no secrets */}
      <Panel title="Provider status">
        <p className="mb-3 text-sm text-[var(--muted)]">
          Read-only connectivity. API keys are never shown and cannot be edited
          here.
        </p>
        <dl className="grid gap-2 sm:grid-cols-2">
          <StatusRow
            label="Alpaca paper endpoint"
            value={alpacaStatus}
            detail={server?.tradingEndpointHost ?? "—"}
            tone={safety?.ok ? "ok" : "bad"}
          />
          <StatusRow
            label="Finnhub"
            value={finnhubStatus}
            detail={`Configured: ${server?.newsProviderConfigured ?? "—"}`}
            tone={finnhubStatus === "Active" ? "ok" : "warn"}
          />
          <StatusRow
            label="Ollama"
            value={ollamaStatus}
            detail={aiStatusDisplayLabel(aiHealth?.statusLabel)}
            tone={ollamaStatus === "Connected" ? "ok" : "warn"}
          />
          <StatusRow
            label="Order execution"
            value={server?.orderExecutionEnabled ? "ON" : "OFF"}
            detail="Paper only — set in .env.local"
            tone={server?.orderExecutionEnabled ? "warn" : "neutral"}
          />
          <StatusRow
            label="Platform"
            value="Paper only"
            detail="Live trading blocked"
            tone="ok"
          />
        </dl>
      </Panel>

      {/* Safety explanation */}
      <Panel title="Safety explanation">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--foreground)]/90">
          <li>
            <strong>Platform Safe</strong> means the app is using paper trading
            only — not that every trade is allowed.
          </li>
          <li>
            <strong>Trade Eligible</strong> means a specific trade passed
            market, data, and risk checks.
          </li>
          <li>
            <strong>Order execution ON</strong> does not mean every trade is
            allowed — market closed, stale quotes, and high risk still block
            submits.
          </li>
          <li>
            <strong>AI never submits orders automatically.</strong> Manual
            confirmation is always required.
          </li>
        </ul>
        {server?.safetyWarnings?.length ? (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-100/90">
            {server.safetyWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={saveDraft}
          className="ui-btn border border-amber-500/50 bg-amber-500/15 text-amber-50"
        >
          Save preferences
        </button>
        <button
          type="button"
          onClick={resetDefaults}
          className="ui-btn border border-[var(--border)] text-[var(--muted)]"
        >
          Reset to defaults
        </button>
      </div>
      {savedMsg ? (
        <p className="text-sm text-emerald-200/90">{savedMsg}</p>
      ) : null}
    </div>
  );
}

function StatusRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/70 bg-[var(--panel-elevated)]/40 px-3 py-2.5">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 font-semibold">
        <StatusDot tone={tone} />
        {value}
      </dd>
      {detail ? (
        <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p>
      ) : null}
    </div>
  );
}
