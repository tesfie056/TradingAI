"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/client/fetch-json";
import {
  clearAiCommandHistory,
  loadAiCommandHistory,
  pushAiCommandHistory,
  saveAiCommandHistory,
  type StoredAiCommand,
} from "@/lib/client/ui-settings";
import type {
  AiCommandRequest,
  AiCommandResponse,
} from "@/lib/ai/command-types";
import { SafetyStrip } from "@/components/ui/SafetyStrip";

const QUICK_ACTIONS = [
  "What can I ask?",
  "Analyze my watchlist",
  "Explain today's strongest stock",
  "Explain why all trades are blocked",
  "Find highest confidence setup",
  "Summarize market/news risk",
  "Prepare paper trade preview",
] as const;

export type AiCommandCenterProps = {
  open: boolean;
  onClose: () => void;
  orderExecutionEnabled: boolean;
  selectedSymbol: string | null;
  buildContext: () => AiCommandRequest["context"];
  onPreparePreview?: (symbol: string, side: "buy" | "sell") => void;
  onSelectSymbol?: (symbol: string) => void;
  seedInstruction?: string | null;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  relatedSymbols?: string[];
  suggestedAction?: string;
  provider?: string;
  usedFallback?: boolean;
  safetyWarnings?: string[];
  tradePreviewAllowed?: boolean;
  previewHint?: AiCommandResponse["previewHint"];
};

export function AiCommandCenter({
  open,
  onClose,
  orderExecutionEnabled,
  selectedSymbol,
  buildContext,
  onPreparePreview,
  onSelectSymbol,
  seedInstruction,
}: AiCommandCenterProps) {
  const [instruction, setInstruction] = useState(
    () => seedInstruction ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [history, setHistory] = useState<StoredAiCommand[]>(() =>
    typeof window === "undefined" ? [] : loadAiCommandHistory(),
  );
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy, open]);

  async function run(text: string) {
    const userInstruction = text.trim();
    if (!userInstruction) return;
    setBusy(true);
    setError(null);

    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      text: userInstruction,
    };
    setTurns((prev) => [...prev, userTurn]);

    const lastUser = [...history].find(() => true);
    // Prefer in-session last user question for follow-ups.
    const priorUser = [...turns].reverse().find((t) => t.role === "user");
    const priorAssistant = [...turns]
      .reverse()
      .find((t) => t.role === "assistant");

    try {
      const body = await fetchJson<AiCommandResponse>("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userInstruction,
          selectedSymbol,
          conversation: {
            lastInstruction:
              priorUser?.text ?? lastUser?.instruction ?? null,
            lastIntentHint:
              priorAssistant?.suggestedAction ??
              (priorUser?.text &&
              /high|low|open|close|yesterday/i.test(priorUser.text)
                ? "historical"
                : null),
          },
          context: buildContext(),
        } satisfies AiCommandRequest),
      });

      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: body.answer,
          relatedSymbols: body.relatedSymbols,
          suggestedAction: body.suggestedAction,
          provider: body.provider,
          usedFallback: body.usedFallback,
          safetyWarnings: body.safetyWarnings,
          tradePreviewAllowed: body.tradePreviewAllowed,
          previewHint: body.previewHint,
        },
      ]);

      setHistory(
        pushAiCommandHistory({
          id: `${Date.now()}`,
          instruction: userInstruction,
          answer: body.answer,
          relatedSymbols: body.relatedSymbols,
          suggestedAction: body.suggestedAction,
          timestamp: body.timestamp,
          provider: body.provider,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI command failed");
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    setTurns([]);
    setHistory([]);
    clearAiCommandHistory();
    saveAiCommandHistory([]);
    setError(null);
    setInstruction("");
  }

  if (!open) return null;

  const latestAssistant = [...turns]
    .reverse()
    .find((t) => t.role === "assistant");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close AI Assistant"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--panel)] shadow-2xl sm:max-w-lg">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
              AI Assistant
            </h2>
            <p className="mt-1 text-base text-[var(--muted)]">
              Trading desk chat · never places orders
              {selectedSymbol ? ` · row focus ${selectedSymbol}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-btn border border-[var(--border)] text-sm text-[var(--muted)]"
            >
              Close
            </button>
            <button
              type="button"
              onClick={clearChat}
              className="text-sm text-[var(--muted)] underline-offset-2 hover:text-amber-100 hover:underline"
            >
              Clear chat
            </button>
          </div>
        </div>

        <div className="border-b border-[var(--border)] px-5 py-3">
          <SafetyStrip orderExecutionEnabled={orderExecutionEnabled} />
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((label) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => {
                  const q =
                    label === "What can I ask?"
                      ? "What can you answer?"
                      : label;
                  setInstruction(q);
                  void run(q);
                }}
                className="rounded-full border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm text-[var(--foreground)]/90 transition hover:border-amber-500/40 disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {turns.length === 0 ? (
              <p className="text-base text-[var(--muted)]">
                Ask about your watchlist, yesterday’s high/low, market risk, or
                why a trade is blocked.
              </p>
            ) : (
              turns.map((t) => (
                <div
                  key={t.id}
                  className={
                    t.role === "user"
                      ? "ml-6 rounded-[var(--radius-sm)] border border-amber-500/25 bg-amber-500/10 px-4 py-3"
                      : "mr-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/60 px-4 py-4"
                  }
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {t.role === "user" ? "You" : "Assistant"}
                    {t.role === "assistant" && t.provider
                      ? ` · ${t.provider}${t.usedFallback ? " fallback" : ""}`
                      : ""}
                  </p>
                  <p
                    className={
                      t.role === "assistant"
                        ? "mt-2 text-lg leading-relaxed text-[var(--foreground)]"
                        : "mt-1.5 text-base leading-relaxed"
                    }
                  >
                    {t.text}
                  </p>
                  {t.role === "assistant" &&
                    t.relatedSymbols &&
                    t.relatedSymbols.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {t.relatedSymbols.map((sym) => (
                          <button
                            key={sym}
                            type="button"
                            onClick={() => onSelectSymbol?.(sym)}
                            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm font-semibold hover:border-amber-500/40"
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    )}
                  {t.role === "assistant" &&
                    t.tradePreviewAllowed &&
                    t.previewHint && (
                      <button
                        type="button"
                        onClick={() =>
                          onPreparePreview?.(
                            t.previewHint!.symbol,
                            t.previewHint!.side,
                          )
                        }
                        className="ui-btn mt-4 border border-amber-500/40 bg-amber-500/10 text-amber-100"
                      >
                        Prepare paper trade preview for {t.previewHint.symbol}
                      </button>
                    )}
                </div>
              ))
            )}
            {busy && (
              <p className="text-base text-[var(--muted)]">Thinking…</p>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <p className="rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </p>
          )}

          <label className="flex flex-col gap-2 text-base">
            <span className="text-sm font-medium text-[var(--muted)]">
              Your question
            </span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              placeholder="e.g. What can you answer? · AAPL high yesterday · why trades are blocked"
              className="resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-3 text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void run(instruction);
                }
              }}
            />
          </label>

          <button
            type="button"
            disabled={busy || !instruction.trim()}
            onClick={() => void run(instruction)}
            className="ui-btn border border-amber-500/50 bg-amber-500/15 text-amber-50 disabled:opacity-40"
          >
            {busy ? "Thinking…" : "Ask AI"}
          </button>

          {latestAssistant?.safetyWarnings &&
            latestAssistant.safetyWarnings.length > 0 && (
              <p className="text-xs leading-relaxed text-[var(--muted)]">
                {latestAssistant.safetyWarnings.join(" · ")}
              </p>
            )}
        </div>
      </aside>
    </div>
  );
}
