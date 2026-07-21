"use client";

import type { ReactNode } from "react";
import { ExpandableSection } from "@/components/ui/ExpandableSection";

/**
 * Level-3 technical content — always collapsed by default.
 */
export function AdvancedDetails({
  title = "Advanced details",
  summary = "Technical and diagnostic information.",
  children,
  tip,
}: {
  title?: string;
  summary?: ReactNode;
  children: ReactNode;
  tip?: ReactNode;
}) {
  return (
    <ExpandableSection
      title={title}
      summary={summary}
      tip={tip}
      defaultOpen={false}
      expandLabel="View advanced details"
      collapseLabel="Hide advanced details"
    >
      {children}
    </ExpandableSection>
  );
}
