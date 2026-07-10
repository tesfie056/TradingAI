/** Shared paper-only banner — keep visible on every page body as well as the status bar. */
export function PaperOnlyBanner({ detail }: { detail?: string }) {
  return (
    <div className="border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
      <span className="font-semibold tracking-wide uppercase">
        Paper trade only
      </span>
      {" · "}
      no live trading · no automatic trading · U.S. stocks only
      {detail ? ` · ${detail}` : ""}
    </div>
  );
}
