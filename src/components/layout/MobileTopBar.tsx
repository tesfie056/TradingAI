"use client";

import { usePathname } from "next/navigation";
import { pageTitleForPath } from "@/lib/client/nav-config";
import { PaperTradingBadge } from "@/components/ui/PaperTradingBadge";

export function MobileTopBar({
  onOpenMenu,
}: {
  onOpenMenu: () => void;
}) {
  const pathname = usePathname();
  const title = pageTitleForPath(pathname);

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--background)]/95 px-3 py-2.5 backdrop-blur-md md:hidden">
      <button
        type="button"
        onClick={onOpenMenu}
        className="ui-btn min-h-11 min-w-11 border border-[var(--border)] px-3 text-sm"
        aria-label="Open navigation menu"
      >
        Menu
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--foreground)]">
          {title}
        </p>
      </div>
      <PaperTradingBadge />
    </header>
  );
}
