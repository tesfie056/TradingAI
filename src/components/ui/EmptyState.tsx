import type { ReactNode } from "react";

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-[var(--border)] bg-[var(--panel-elevated)]/40 px-4 py-8 text-center">
      <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
      {children ? (
        <div className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}
