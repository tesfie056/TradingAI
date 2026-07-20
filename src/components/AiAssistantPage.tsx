"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
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
        description="The assistant stays available as a floating panel while you move between pages."
      />
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)] px-4 py-4 text-base shadow-sm shadow-black/10">
        <p>
          Use the <strong>AI Assistant</strong> button in the header to open the
          floating panel. Questions keep running if you change pages.
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Paper only · the assistant never submits orders ·{" "}
          <Link href="/trade" className="underline underline-offset-2">
            Open Positions
          </Link>{" "}
          for manual paper preview.
        </p>
      </div>
    </div>
  );
}
