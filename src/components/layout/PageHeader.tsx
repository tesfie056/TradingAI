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
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="h1">{title}</h1>
        {description ? (
          <p className="mt-2 text-base text-[var(--muted)] sm:text-lg">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap gap-2">{actions}</div>
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
