"use client";

import type { SystemStatusTone } from "@/lib/client/system-status-label";
import type { StatusLightKind } from "@/lib/client/status-state-mapper";

export function StatusLight({
  tone,
  kind = "solid",
}: {
  tone: SystemStatusTone;
  kind?: StatusLightKind;
}) {
  const color =
    tone === "ok"
      ? "bg-emerald-400"
      : tone === "bad"
        ? "bg-rose-400"
        : tone === "warn"
          ? "bg-amber-400"
          : "bg-zinc-500";

  const glow =
    tone === "ok"
      ? "shadow-[0_0_6px_rgba(52,211,153,0.55)]"
      : tone === "bad"
        ? "shadow-[0_0_6px_rgba(251,113,133,0.55)]"
        : "";

  if (kind === "hollow") {
    return (
      <span
        aria-hidden
        className={`inline-block h-2 w-2 shrink-0 rounded-full border border-zinc-500 bg-transparent`}
      />
    );
  }

  if (kind === "ring") {
    return (
      <span
        aria-hidden
        className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
      >
        <span
          className={`absolute inset-0 rounded-full border-2 ${
            tone === "warn" ? "border-amber-400" : "border-zinc-400"
          }`}
        />
        <span className={`h-1 w-1 rounded-full ${color}`} />
      </span>
    );
  }

  if (kind === "alert") {
    return (
      <span
        aria-hidden
        className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
      >
        <span className={`h-2 w-2 rounded-full ${color} ${glow}`} />
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-[1px] bg-rose-300" />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${color} ${glow}`}
    />
  );
}
