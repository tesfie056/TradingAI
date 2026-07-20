/** Critical always-visible paper-trading safety label. */
export function PaperTradingBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-100 ${className}`}
    >
      Paper Trading
    </span>
  );
}
