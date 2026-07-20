import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";

export type CompactStatusTone = "ok" | "warn" | "neutral" | "bad" | "info";

function toneClasses(tone: CompactStatusTone): string {
  if (tone === "ok") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-50";
  if (tone === "warn") return "border-amber-500/35 bg-amber-500/10 text-amber-50";
  if (tone === "bad") return "border-red-500/40 bg-red-950/35 text-red-50";
  if (tone === "info") return "border-sky-500/35 bg-sky-500/10 text-sky-50";
  return "border-[var(--border)] bg-[var(--panel-elevated)]/80 text-zinc-100";
}

export function CompactStatusCard({
  title,
  message,
  detail,
  tone = "neutral",
  metrics,
  action,
  footer,
}: {
  title: string;
  message: string;
  detail?: string;
  tone?: CompactStatusTone;
  metrics?: { label: string; value: string }[];
  action?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Panel title={title} className="shadow-sm shadow-black/20" action={action}>
      <div
        className={`rounded-[var(--radius-sm)] border px-4 py-3 ${toneClasses(tone)}`}
        role="status"
      >
        <p className="text-base font-semibold tracking-tight sm:text-lg">
          {message}
        </p>
        {detail ? <p className="mt-1 text-sm opacity-90">{detail}</p> : null}
      </div>
      {metrics && metrics.length > 0 ? (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-xs text-[var(--muted)]">{m.label}</dt>
              <dd className="font-medium text-zinc-100">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {footer}
    </Panel>
  );
}
