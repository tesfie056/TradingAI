import type { ReactNode } from "react";

export function Panel({
  title,
  children,
  className = "",
  action,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`ui-card flex flex-col gap-4 ${className}`}>
      {title || action ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)] sm:text-lg">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
