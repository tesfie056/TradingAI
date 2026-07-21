"use client";

import Link from "next/link";

/**
 * Entry point to full scan diagnostics (Advanced Monitoring).
 * Keeps technical detail off the Overview surface.
 */
export function ScanDetailsDrawer({
  href = "/monitor",
  label = "View scan details",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-block text-xs text-amber-100 underline"
    >
      {label}
    </Link>
  );
}
