import type { ReactNode } from "react";
import Link from "next/link";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 max-w-3xl">
        <h1 className="h1">{title}</h1>
        {description ? (
          <p className="mt-1.5 text-sm text-[var(--muted)] sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function PageLinkButton({
  href,
  children,
  tone = "default",
}: {
  href: string;
  children: ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <Link
      href={href}
      className={`ui-btn ${
        tone === "accent"
          ? "border border-amber-500/45 bg-amber-500/15 text-amber-50"
          : "border border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--foreground)]"
      }`}
    >
      {children}
    </Link>
  );
}
