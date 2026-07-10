"use client";

import { useState } from "react";
import type { OrderGateBlocker } from "@/lib/trades/types";
import {
  buildTradeEligibilityChecklist,
  collectUiBlockExplanations,
  groupExplanationsByCategory,
  primarySubmitStatus,
  splitPrimarySecondaryExplanations,
  uniqueWhatToChange,
  type BlockExplanation,
  type EligibilityCheckItem,
} from "@/lib/trades/block-explanations";
import { StatusDot } from "@/components/ui/SafetyStrip";

export function PaperTradeBlockPanel({
  blockers,
  approved,
  executionEnabled,
}: {
  blockers: OrderGateBlocker[];
  approved: boolean;
  executionEnabled: boolean;
}) {
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [fullReasonOpen, setFullReasonOpen] = useState(false);

  const explanations = collectUiBlockExplanations({ blockers, approved });
  const status = primarySubmitStatus(explanations);
  const { primary, secondary, marketClosedNote } =
    splitPrimarySecondaryExplanations(explanations);
  const groups = groupExplanationsByCategory(explanations);
  const nextSteps = uniqueWhatToChange(explanations);
  const checklist = buildTradeEligibilityChecklist({ blockers, approved });
  const ready = status.kind === "ready";
  const failCount = checklist.filter((c) => !c.pass).length;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Compact status + primary reason */}
      <div
        className={`rounded-[var(--radius-sm)] border px-3.5 py-3 ${
          ready
            ? "border-emerald-500/35 bg-emerald-500/10"
            : "border-rose-500/40 bg-rose-500/10"
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--muted)]">
            <StatusDot tone="ok" />
            Platform Safe · Paper Only
          </span>
          <span className="text-[var(--border)]">·</span>
          <span
            className={`inline-flex items-center gap-1.5 font-semibold ${
              ready ? "text-emerald-100" : "text-rose-100"
            }`}
          >
            <StatusDot tone={ready ? "ok" : "bad"} />
            {ready ? "Trade Eligible" : "Trade Blocked"}
          </span>
          <span className="text-[var(--border)]">·</span>
          <span className="text-[var(--muted)]">
            Execution {executionEnabled ? "ON" : "OFF"}
          </span>
        </div>

        {!ready && primary ? (
          <p className="mt-2 text-base font-semibold text-rose-50">
            Primary reason: {primary.title}
          </p>
        ) : null}
        {ready ? (
          <p className="mt-1.5 text-sm text-emerald-100/90">
            Eligibility checks look clear. Confirm below — AI never places
            orders.
          </p>
        ) : null}
        {marketClosedNote && !fullReasonOpen ? (
          <p className="mt-1.5 text-xs leading-snug text-amber-50/85">
            Stale quote / wide spread / high risk often appear because the
            market is closed. Refresh when it opens.
          </p>
        ) : null}
      </div>

      {/* Pass/fail checklist */}
      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/40 px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight">
            Eligibility checklist
          </h3>
          <span className="text-xs text-[var(--muted)]">
            {failCount === 0
              ? "All clear"
              : `${failCount} fail${failCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {checklist.map((item) => (
            <ChecklistRow key={item.id} item={item} />
          ))}
        </ul>
      </div>

      {/* Secondary effects — collapsed by default */}
      {!ready && secondary.length > 0 ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/80 bg-[var(--panel)]/30">
          <button
            type="button"
            onClick={() => setSecondaryOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm"
            aria-expanded={secondaryOpen}
          >
            <span className="font-medium text-[var(--muted)]">
              Secondary effects ({secondary.length})
            </span>
            <span className="shrink-0 text-xs text-amber-100/80">
              {secondaryOpen ? "Hide" : "Show"}
            </span>
          </button>
          {secondaryOpen ? (
            <ul className="space-y-1 border-t border-[var(--border)]/60 px-3.5 py-2 text-sm text-[var(--foreground)]/85">
              {secondary.map((s) => (
                <li key={s.code} className="flex gap-2">
                  <span className="text-[var(--muted)]">·</span>
                  <span>
                    <span className="font-medium">{s.title}</span>
                    <span className="text-[var(--muted)]"> — {s.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-[var(--border)]/40 px-3.5 pb-2 text-xs text-[var(--muted)]">
              {secondary.map((s) => s.title).join(" · ")}
            </p>
          )}
        </div>
      ) : null}

      {/* Full detailed reason — behind a button */}
      {!ready ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/80">
          <button
            type="button"
            onClick={() => setFullReasonOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm font-medium text-amber-100/90"
            aria-expanded={fullReasonOpen}
          >
            {fullReasonOpen ? "Hide full reason" : "View full reason"}
            <span className="text-xs text-[var(--muted)]">
              Trade Blocked — cannot submit yet
            </span>
          </button>
          {fullReasonOpen ? (
            <div className="border-t border-[var(--border)]/60 px-3.5 py-3">
              <p className="text-sm text-[var(--muted)]">
                This order is blocked for these reasons:
              </p>
              <ol className="mt-3 space-y-3">
                {(primary ? [primary, ...secondary] : explanations).map(
                  (item, index) => (
                    <BlockedReasonItem
                      key={`${item.code}-${index}`}
                      index={index + 1}
                      item={item}
                      badge={index === 0 ? "Primary" : "Secondary"}
                    />
                  ),
                )}
              </ol>

              {groups.length > 0 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {groups.map((g) => (
                    <div
                      key={g.category}
                      className="rounded-[var(--radius-sm)] border border-[var(--border)]/70 bg-[var(--panel)]/40 px-3 py-2"
                    >
                      <p className="text-xs font-semibold text-[var(--muted)]">
                        {g.label}
                      </p>
                      <ul className="mt-1 space-y-0.5 text-sm">
                        {g.items.map((i) => (
                          <li key={i.code}>{i.title}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}

              {marketClosedNote ? (
                <p className="mt-3 text-sm leading-relaxed text-amber-50/90">
                  {marketClosedNote}
                </p>
              ) : null}

              <div className="mt-3">
                <h4 className="text-sm font-semibold">What needs to change</h4>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-[var(--foreground)]/90">
                  {nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ChecklistRow({ item }: { item: EligibilityCheckItem }) {
  return (
    <li
      className={`flex items-start gap-2 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-sm ${
        item.pass
          ? "border-emerald-500/25 bg-emerald-500/5"
          : "border-rose-500/30 bg-rose-500/5"
      }`}
    >
      <StatusDot tone={item.pass ? "ok" : "bad"} />
      <div className="min-w-0 leading-snug">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{item.label}</span>
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${
              item.pass ? "text-emerald-300/90" : "text-rose-300/90"
            }`}
          >
            {item.pass ? "Pass" : "Fail"}
          </span>
        </div>
        {!item.pass ? (
          <p className="mt-0.5 text-xs text-[var(--muted)]">{item.failHint}</p>
        ) : null}
      </div>
    </li>
  );
}

function BlockedReasonItem({
  index,
  item,
  badge,
}: {
  index: number;
  item: BlockExplanation;
  badge?: string;
}) {
  return (
    <li className="rounded-[var(--radius-sm)] border border-[var(--border)]/70 bg-[var(--panel)]/40 px-3 py-2.5">
      <p className="text-sm font-semibold">
        {index}. {item.title}
        {badge ? (
          <span className="ml-2 text-xs font-medium uppercase tracking-wide text-amber-200/80">
            {badge}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-[var(--foreground)]/90">
        {item.detail}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
        <span className="font-medium text-[var(--foreground)]/75">
          What to do:{" "}
        </span>
        {item.whatToChange}. Paper trading only — no live or automatic trading.
      </p>
    </li>
  );
}
