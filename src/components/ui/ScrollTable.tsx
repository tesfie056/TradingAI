import type { ReactNode } from "react";

/** Horizontal scroll wrapper so wide tables stay readable on small screens. */
export function ScrollTable({
  children,
  minWidthClass = "min-w-[40rem]",
}: {
  children: ReactNode;
  minWidthClass?: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 sm:mx-0 sm:px-0">
      <div className={minWidthClass}>{children}</div>
    </div>
  );
}
