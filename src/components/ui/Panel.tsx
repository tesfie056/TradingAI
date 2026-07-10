import type { ReactNode } from "react";

export function Panel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-3 border border-[var(--border)] bg-[var(--panel)] p-4 ${className}`}
    >
      {title ? (
        <h2 className="text-sm font-semibold tracking-wide text-[var(--muted)] uppercase">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}
