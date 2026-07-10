"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { useUiChrome } from "@/components/layout/UiChromeContext";

/**
 * /assistant opens the floating AI popup (persistent across routes).
 */
export function AiAssistantPage() {
  const { openAi } = useUiChrome();

  useEffect(() => {
    const t = window.setTimeout(() => openAi(), 0);
    return () => window.clearTimeout(t);
  }, [openAi]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="AI Assistant"
        description="The assistant opens as a floating window so answers keep loading if you change pages."
      />
      <SafetyBanner orderExecutionEnabled={false} />
      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/40 px-4 py-4 text-base">
        <p>
          Use the floating <strong>AI Assistant</strong> popup (top-right button
          also opens it). Tasks run on the server — navigating away will not
          cancel a running question.
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Paper only · AI never submits orders ·{" "}
          <Link href="/trade" className="underline">
            Open Trade
          </Link>{" "}
          for manual paper preview.
        </p>
      </div>
    </div>
  );
}
