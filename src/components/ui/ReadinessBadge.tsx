export type ReadinessKind =
  | "ready"
  | "waiting"
  | "not_eligible"
  | "position_open"
  | "market_closed"
  | "data_unavailable"
  | "hold";

const LABELS: Record<ReadinessKind, string> = {
  ready: "Ready",
  waiting: "Waiting",
  not_eligible: "Not eligible",
  position_open: "Position already open",
  market_closed: "Market closed",
  data_unavailable: "Data unavailable",
  hold: "Hold",
};

function toneClass(kind: ReadinessKind): string {
  if (kind === "ready") return "text-emerald-300";
  if (kind === "waiting" || kind === "hold") return "text-zinc-200";
  if (kind === "market_closed" || kind === "data_unavailable") {
    return "text-[var(--muted)]";
  }
  return "text-amber-200";
}

export function ReadinessBadge({
  kind,
  detail,
}: {
  kind: ReadinessKind;
  detail?: string;
}) {
  return (
    <div className="min-w-0">
      <p className={`text-sm font-medium ${toneClass(kind)}`}>
        Status: {LABELS[kind]}
      </p>
      {detail ? (
        <p className="mt-0.5 text-xs text-[var(--muted)]">{detail}</p>
      ) : null}
    </div>
  );
}

/** Map common technical block phrases into a single readiness kind. */
export function readinessFromSignals(input: {
  ready?: boolean;
  marketClosed?: boolean;
  executionOff?: boolean;
  hasOpenPosition?: boolean;
  blockReasons?: string[];
  action?: string | null;
}): { kind: ReadinessKind; detail?: string; whyWaiting: string[] } {
  const reasons = input.blockReasons ?? [];
  const whyWaiting = reasons.map(friendlyBlockReason).filter(Boolean);

  if (input.marketClosed) {
    return {
      kind: "market_closed",
      whyWaiting: whyWaiting.length ? whyWaiting : ["Market is closed"],
    };
  }
  if (input.hasOpenPosition) {
    return {
      kind: "position_open",
      whyWaiting: whyWaiting.length
        ? whyWaiting
        : ["A paper position is already open for this symbol"],
    };
  }
  if (input.ready) {
    return { kind: "ready", whyWaiting: [] };
  }

  const joined = reasons.join(" ").toLowerCase();
  if (
    joined.includes("quote") ||
    joined.includes("unavailable") ||
    joined.includes("no data") ||
    joined.includes("stale")
  ) {
    return {
      kind: "data_unavailable",
      detail: "Waiting for price data",
      whyWaiting,
    };
  }
  if (joined.includes("spread")) {
    return {
      kind: "waiting",
      detail: "Price spread too wide",
      whyWaiting,
    };
  }
  if (input.action === "HOLD") {
    return {
      kind: "hold",
      detail:
        reasons.length > 1
          ? `${reasons.length} conditions not met`
          : whyWaiting[0],
      whyWaiting,
    };
  }
  if (reasons.length > 0) {
    return {
      kind: "waiting",
      detail:
        reasons.length > 1
          ? `${reasons.length} conditions not met`
          : whyWaiting[0],
      whyWaiting,
    };
  }
  return { kind: "not_eligible", whyWaiting };
}

export function friendlyBlockReason(raw: string): string {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (lower.includes("quote") && lower.includes("unavailable")) {
    return "Waiting for price data";
  }
  if (lower.includes("wide spread") || lower.includes("spread")) {
    return "Price spread is too wide";
  }
  if (lower.includes("market") && lower.includes("closed")) {
    return "Market is closed";
  }
  if (lower.includes("incomplete") || lower.includes("signal")) {
    return "Entry signal is incomplete";
  }
  if (lower.includes("skip") && lower.includes("blocked")) {
    return "No trade was opened because entry rules were not met";
  }
  // Drop overly technical noise for the default list
  if (/^[A-Z0-9_.:-]{8,}$/.test(t)) return "";
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}
