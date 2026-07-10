"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "ok" | "warn" | "bad" | "neutral";

export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  pushToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const pushToast = useCallback((message: string, tone: ToastTone = "ok") => {
    const id = `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
        aria-live="polite"
      >
        {items.map((t) => {
          const toneCls =
            t.tone === "ok"
              ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-50"
              : t.tone === "warn"
                ? "border-amber-500/40 bg-amber-950/90 text-amber-50"
                : t.tone === "bad"
                  ? "border-red-500/40 bg-red-950/90 text-red-50"
                  : "border-zinc-600 bg-zinc-900/95 text-zinc-100";
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg ${toneCls}`}
            >
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      pushToast: (message: string) => {
        // Fallback when provider is missing — log only, never native dialogs
        console.info("[toast]", message);
      },
    };
  }
  return ctx;
}
