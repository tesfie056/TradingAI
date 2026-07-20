"use client";

import {
  resolveSystemStatusLabel,
  type SystemStatusInput,
} from "@/lib/client/system-status-label";
import { StatusLight } from "@/components/status/StatusLight";

/**
 * Compact sidebar / drawer trigger for the shared system status panel.
 * Does not maintain a separate status interpretation — label comes from the shared mapper.
 */
export type SystemStatusPopoverProps = SystemStatusInput & {
  paperOnly?: boolean;
  aiProvider: string;
  newsProvider?: string;
  safetyLabel?: string;
  agentHeartbeatAt?: string | null;
  brokerConnected?: boolean | null;
  monitorLastError?: string | null;
  monitorLastScanAt?: string | null;
  monitorStocksScanned?: number | null;
  monitorOllamaAvailable?: boolean | null;
  placement?: "bottom" | "top";
  compact?: boolean;
  /** Opens the shared SystemStatusPanel owned by AppShell. */
  onOpenPanel?: () => void;
};

export function SystemStatusPopover(props: SystemStatusPopoverProps) {
  const { compact = false, onOpenPanel, ...statusInput } = props;
  const { label, tone } = resolveSystemStatusLabel(statusInput);

  return (
    <button
      type="button"
      className={`ui-btn inline-flex min-h-10 w-full items-center gap-2 border border-[var(--border)] bg-[var(--panel-elevated)] text-sm font-medium text-zinc-100 active:scale-[0.99] ${
        compact ? "justify-center px-2 py-2" : "justify-between px-3 py-2"
      }`}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      onClick={() => onOpenPanel?.()}
    >
      <span className="inline-flex items-center gap-2">
        <StatusLight
          tone={tone}
          kind={
            tone === "bad"
              ? "alert"
              : tone === "warn"
                ? "ring"
                : tone === "ok"
                  ? "solid"
                  : "hollow"
          }
        />
        {!compact ? (
          <span className="text-left text-[var(--muted)]">System status</span>
        ) : (
          <span className="sr-only">System status</span>
        )}
      </span>
      {!compact ? (
        <span className="text-[10px] text-[var(--muted)]" aria-hidden>
          ▴
        </span>
      ) : null}
    </button>
  );
}
