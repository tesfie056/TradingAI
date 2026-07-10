"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

export type ConfirmActionModalProps = {
  open: boolean;
  title: string;
  description?: string;
  warning?: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive / dangerous confirm styling */
  danger?: boolean;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  /** When set, user must type this exact string to enable confirm */
  requireTypedText?: string;
  typedValue?: string;
  onTypedValueChange?: (value: string) => void;
  /**
   * When true, backdrop click closes (safe actions only).
   * Dangerous actions should leave this false.
   */
  allowBackdropClose?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Reusable in-app confirmation modal — never uses native browser dialogs.
 */
export function ConfirmActionModal({
  open,
  title,
  description,
  warning,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  loading = false,
  error = null,
  disabled = false,
  requireTypedText,
  typedValue = "",
  onTypedValueChange,
  allowBackdropClose = false,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const typedOk =
    !requireTypedText ||
    typedValue.trim().toUpperCase() === requireTypedText.toUpperCase();
  const confirmDisabled = disabled || loading || !typedOk;

  const handleCancel = useCallback(() => {
    if (loading) return;
    onCancel();
  }, [loading, onCancel]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusables?.[0];
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const firstEl = nodes[0]!;
      const lastEl = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, handleCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/65"
        aria-hidden
        onClick={() => {
          if (allowBackdropClose && !loading) handleCancel();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="relative z-[81] flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel-elevated)] shadow-2xl"
      >
        <div className="overflow-y-auto px-5 py-4">
          <h2
            id={titleId}
            className="text-lg font-semibold text-zinc-50"
          >
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-2 text-sm leading-relaxed text-zinc-300">
              {description}
            </p>
          ) : null}
          {warning ? (
            <p
              className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                danger
                  ? "border-red-500/40 bg-red-950/50 text-red-100"
                  : "border-amber-500/40 bg-amber-950/40 text-amber-100"
              }`}
              role="status"
            >
              {warning}
            </p>
          ) : null}
          {children ? <div className="mt-4 space-y-2">{children}</div> : null}
          {requireTypedText ? (
            <label className="mt-4 block text-sm text-zinc-300">
              Type{" "}
              <span className="font-mono font-semibold text-zinc-100">
                {requireTypedText}
              </span>{" "}
              to confirm
              <input
                type="text"
                value={typedValue}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => onTypedValueChange?.(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-zinc-600 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-zinc-400"
                placeholder={requireTypedText}
              />
            </label>
          ) : null}
          {error ? (
            <p
              className="mt-3 rounded-md border border-red-500/40 bg-red-950/60 px-3 py-2 text-sm text-red-100"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] bg-zinc-950/40 px-5 py-3">
          <button
            type="button"
            disabled={loading}
            onClick={handleCancel}
            className="rounded-md border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={() => {
              if (confirmDisabled) return;
              onConfirm();
            }}
            className={`rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
              danger
                ? "bg-red-700 text-white hover:bg-red-600"
                : "bg-emerald-600 text-white hover:bg-emerald-500"
            }`}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
