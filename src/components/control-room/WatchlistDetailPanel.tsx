"use client";

import type { ReactNode } from "react";
import { BlockReasonList } from "@/components/ui/BlockReasonList";
import { ScoreBadges } from "@/components/ui/badges";
import { formatTime } from "@/lib/format";
import type { AiDecision, DecisionHistoryEntry } from "@/lib/alpaca/types";
import type { SymbolNewsAnalysis } from "@/lib/news/types";
import { canShowPreparePaperTrade } from "@/lib/trades/gates";

export function WatchlistDetailPanel({
  d,
  open,
  allBlockReasons,
  news,
  history,
  onAskAi,
  onPrepare,
  compareWith,
  simple = true,
  colSpan = 6,
}: {
  d: AiDecision;
  open: boolean;
  allBlockReasons: string[];
  news: SymbolNewsAnalysis | null;
  history: DecisionHistoryEntry[];
  onAskAi: () => void;
  onPrepare: () => void;
  compareWith?: AiDecision | null;
  simple?: boolean;
  colSpan?: number;
}) {
  const canPrepare = canShowPreparePaperTrade(d);
  const headlines =
    news?.items?.map((i) => i.headline).filter(Boolean) ??
    d.newsContext?.headlines ??
    [];

  return (
    <tr
      className={
        open
          ? "border-b border-[var(--border)]/50 bg-[var(--panel-elevated)]/40"
          : "border-0"
      }
      aria-hidden={!open}
    >
      <td colSpan={colSpan} className="p-0">
        <div className="watchlist-expand" data-open={open ? "true" : "false"}>
          <div className="watchlist-expand__inner">
            <div className="space-y-5 px-4 py-5 sm:px-5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onAskAi}
                  className="ui-btn border border-amber-500/40 bg-amber-500/12 text-amber-50"
                >
                  Ask AI about this stock
                </button>
                {canPrepare ? (
                  <button
                    type="button"
                    onClick={onPrepare}
                    className="ui-btn border border-emerald-500/40 bg-emerald-500/12 text-emerald-50"
                  >
                    Prepare paper trade preview
                  </button>
                ) : (
                  <span className="self-center text-sm text-[var(--muted)]">
                    Paper preview not available for this setup
                  </span>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <DetailBlock title="Technical">
                  {d.explanation?.technical ?? "—"}
                </DetailBlock>
                <DetailBlock title="News">
                  {d.explanation?.news ?? news?.explanation ?? "—"}
                </DetailBlock>
                <DetailBlock title="Market">
                  {d.explanation?.market ??
                    d.marketCondition?.explanation ??
                    "—"}
                </DetailBlock>
                <DetailBlock title="Risk">
                  {d.explanation?.risk ?? "—"}
                </DetailBlock>
              </div>

              <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/80 bg-[var(--panel)]/50 p-4">
                <h3 className="text-sm font-semibold text-amber-200/95">
                  AI explanation
                </h3>
                <p className="mt-2 text-base leading-relaxed">
                  {d.explanation?.summary ?? d.reasons[0] ?? "—"}
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-rose-200/90">
                  Blocked reasons
                </h3>
                <BlockReasonList
                  reasons={allBlockReasons}
                  emptyLabel="None — gates clear for this symbol"
                  layout="inline"
                />
              </div>

              {!simple && (
                <>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-[var(--muted)]">
                      Recent headlines
                    </h3>
                    {headlines.length > 0 ? (
                      <ul className="list-disc space-y-1.5 pl-5 text-base text-[var(--foreground)]/85">
                        {headlines.slice(0, 5).map((h) => (
                          <li key={h}>{h}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-base text-[var(--muted)]">
                        No headlines
                      </p>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-[var(--muted)]">
                      Recent decisions
                    </h3>
                    {history.length > 0 ? (
                      <ul className="space-y-2 text-base">
                        {history.slice(0, 5).map((h, i) => (
                          <li
                            key={`${h.timestamp}-${i}`}
                            className="flex flex-wrap gap-x-3 text-[var(--foreground)]/85"
                          >
                            <span className="text-[var(--muted)]">
                              {formatTime(h.timestamp)}
                            </span>
                            <span className="font-semibold">{h.action}</span>
                            <span className="tabular-nums">
                              {(h.confidence * 100).toFixed(0)}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-base text-[var(--muted)]">
                        No history yet
                      </p>
                    )}
                  </div>

                  {d.scores && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-[var(--muted)]">
                        Score breakdown
                      </h3>
                      <ScoreBadges scores={d.scores} />
                    </div>
                  )}

                  {compareWith && compareWith.symbol !== d.symbol && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-amber-200/90">
                        Compare · {d.symbol} vs {compareWith.symbol}
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-2 text-base">
                        <CompareCard label={d.symbol} decision={d} />
                        <CompareCard
                          label={compareWith.symbol}
                          decision={compareWith}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function DetailBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/70 bg-[var(--panel)]/40 p-3.5">
      <h3 className="text-sm font-semibold text-[var(--muted)]">{title}</h3>
      <p className="mt-2 text-base leading-relaxed text-[var(--foreground)]/90">
        {children}
      </p>
    </div>
  );
}

function CompareCard({
  label,
  decision,
}: {
  label: string;
  decision: AiDecision;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel)]/60 px-3.5 py-3">
      <p className="text-lg font-semibold">{label}</p>
      <p className="mt-1.5">
        {decision.action} · {(decision.confidence * 100).toFixed(0)}%
      </p>
    </div>
  );
}
