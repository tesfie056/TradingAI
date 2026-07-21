"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { PaperTradingBadge } from "@/components/ui/PaperTradingBadge";
import { NavIcon } from "@/components/layout/NavIcon";
import { SystemStatusPopover } from "@/components/layout/SystemStatusPopover";
import {
  ensureSidebarDefaultForViewport,
  getSidebarCollapsedServerSnapshot,
  getSidebarCollapsedSnapshot,
  subscribeSidebarCollapsed,
  toggleSidebarCollapsed,
} from "@/lib/client/sidebar-prefs";
import { isNavActive, NAV_GROUPS } from "@/lib/client/nav-config";
import type { SystemStatusPopoverProps } from "@/components/layout/SystemStatusPopover";

export type DesktopSidebarProps = {
  status: SystemStatusPopoverProps;
  onAskAi: () => void;
  aiThinking?: boolean;
  aiResultsReady?: number;
  onToggleViewMode?: () => void;
  viewMode?: "simple" | "advanced";
  onOpenSystemStatus?: () => void;
};

function navItemClass(active: boolean, collapsed: boolean): string {
  return `group relative flex items-center gap-3 rounded-[var(--radius-sm)] text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400/50 ${
    collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2"
  } ${
    active
      ? "bg-[var(--panel-elevated)] text-[var(--foreground)]"
      : "text-[var(--muted)] hover:bg-[var(--panel-elevated)]/70 hover:text-[var(--foreground)]"
  }`;
}

export function DesktopSidebar({
  status,
  onAskAi,
  aiThinking = false,
  aiResultsReady = 0,
  onToggleViewMode,
  viewMode = "simple",
  onOpenSystemStatus,
}: DesktopSidebarProps) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot,
  );

  useEffect(() => {
    ensureSidebarDefaultForViewport();
  }, []);

  return (
    <aside
      className={`sticky top-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]/90 backdrop-blur-md md:flex motion-reduce:transition-none motion-safe:transition-[width] motion-safe:duration-200 ${
        collapsed ? "w-[72px]" : "w-[248px]"
      }`}
      aria-label="Desktop sidebar"
    >
      <div
        className={`flex items-start gap-2 border-b border-[var(--border)]/80 ${
          collapsed ? "flex-col items-center px-2 py-3" : "px-4 py-4"
        }`}
      >
        <div className={collapsed ? "flex flex-col items-center gap-2" : "min-w-0 flex-1"}>
          <Link
            href="/dashboard"
            className={`font-[family-name:var(--font-display)] tracking-tight text-[var(--foreground)] ${
              collapsed ? "text-lg" : "text-xl"
            }`}
            title="TradingAI"
          >
            {collapsed ? "TA" : "TradingAI"}
          </Link>
          {collapsed ? (
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-500/45 bg-amber-500/15 text-[11px] font-semibold text-amber-100"
              title="Paper trading only — no live orders"
              aria-label="Paper trading only — no live orders"
            >
              P
            </span>
          ) : (
            <div className="mt-1.5">
              <PaperTradingBadge />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => toggleSidebarCollapsed()}
          className="ui-btn mt-0.5 border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="mb-4">
            {!collapsed ? (
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                {group.label}
              </p>
            ) : (
              <div className="mb-1 h-px bg-[var(--border)]/60" aria-hidden />
            )}
            <ul className="space-y-0.5" role="list">
              {group.items.map((item) => {
                const active = isNavActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={navItemClass(active, collapsed)}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                    >
                      {active ? (
                        <span
                          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-amber-400/80"
                          aria-hidden
                        />
                      ) : null}
                      <span
                        className={
                          active ? "text-amber-100" : "text-[var(--muted)]"
                        }
                      >
                        <NavIcon id={item.icon} />
                      </span>
                      {!collapsed ? <span>{item.label}</span> : null}
                      {collapsed ? <span className="sr-only">{item.label}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div
        className={`mt-auto space-y-2 border-t border-[var(--border)]/80 p-2 ${
          collapsed ? "items-center" : ""
        }`}
      >
        <button
          type="button"
          onClick={onAskAi}
          className={`ui-btn flex w-full items-center gap-2 border border-amber-500/40 bg-amber-500/12 text-amber-50 hover:bg-amber-500/20 ${
            collapsed ? "justify-center px-2" : "px-3"
          }`}
          aria-label={
            aiThinking
              ? "AI Assistant — thinking"
              : aiResultsReady > 0
                ? "AI Assistant — result ready"
                : "AI Assistant"
          }
          title="AI Assistant"
        >
          <span aria-hidden className="text-sm font-semibold">
            AI
          </span>
          {!collapsed ? (
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2 text-sm">
              AI Assistant
              {aiThinking ? (
                <span className="text-[10px] text-amber-100/90">Thinking</span>
              ) : null}
              {!aiThinking && aiResultsReady > 0 ? (
                <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-[10px] text-emerald-100">
                  {aiResultsReady}
                </span>
              ) : null}
            </span>
          ) : null}
        </button>

        <div className={collapsed ? "flex justify-center" : ""}>
          <SystemStatusPopover
            {...status}
            placement="top"
            compact={collapsed}
            onOpenPanel={onOpenSystemStatus}
          />
        </div>

        {onToggleViewMode && !collapsed ? (
          <button
            type="button"
            onClick={onToggleViewMode}
            className="ui-btn w-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]"
            title="Toggle simple or detailed desk view"
          >
            {viewMode === "simple" ? "Simple view" : "Advanced view"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
