"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_AI_INDICATOR,
  loadAiIndicator,
  loadAiPopupOpen,
  saveAiIndicator,
  saveAiPopupOpen,
  type AiChromeIndicator,
} from "@/lib/client/ai-popup";
import {
  getViewModeServerSnapshot,
  getViewModeSnapshot,
  loadUiSettings,
  saveUiSettings,
  subscribeUiSettings,
  type UiViewMode,
} from "@/lib/client/ui-settings";

type UiChromeValue = {
  viewMode: UiViewMode;
  setViewMode: (mode: UiViewMode) => void;
  toggleViewMode: () => void;
  aiOpen: boolean;
  openAi: (seed?: string | null) => void;
  closeAi: () => void;
  aiSeed: string | null;
  aiIndicator: AiChromeIndicator;
  setAiIndicator: (next: AiChromeIndicator) => void;
};

const UiChromeContext = createContext<UiChromeValue | null>(null);

export function UiChromeProvider({ children }: { children: ReactNode }) {
  const viewMode = useSyncExternalStore(
    subscribeUiSettings,
    getViewModeSnapshot,
    getViewModeServerSnapshot,
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeed, setAiSeed] = useState<string | null>(null);
  const [aiIndicator, setAiIndicatorState] =
    useState<AiChromeIndicator>(DEFAULT_AI_INDICATOR);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAiOpen(loadAiPopupOpen());
      setAiIndicatorState(loadAiIndicator());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const setViewMode = useCallback((mode: UiViewMode) => {
    const ui = loadUiSettings();
    saveUiSettings({ ...ui, viewMode: mode });
  }, []);

  const toggleViewMode = useCallback(() => {
    const ui = loadUiSettings();
    const next: UiViewMode = ui.viewMode === "simple" ? "advanced" : "simple";
    saveUiSettings({ ...ui, viewMode: next });
  }, []);

  const setAiIndicator = useCallback((next: AiChromeIndicator) => {
    setAiIndicatorState(next);
    saveAiIndicator(next);
  }, []);

  const openAi = useCallback((seed?: string | null) => {
    setAiSeed(seed ?? null);
    setAiOpen(true);
    saveAiPopupOpen(true);
    setAiIndicatorState((prev) => {
      const cleared = { ...prev, resultsReady: 0 };
      saveAiIndicator(cleared);
      return cleared;
    });
  }, []);

  const closeAi = useCallback(() => {
    setAiOpen(false);
    setAiSeed(null);
    saveAiPopupOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      viewMode,
      setViewMode,
      toggleViewMode,
      aiOpen: hydrated ? aiOpen : false,
      openAi,
      closeAi,
      aiSeed,
      aiIndicator,
      setAiIndicator,
    }),
    [
      viewMode,
      setViewMode,
      toggleViewMode,
      hydrated,
      aiOpen,
      openAi,
      closeAi,
      aiSeed,
      aiIndicator,
      setAiIndicator,
    ],
  );

  return (
    <UiChromeContext.Provider value={value}>{children}</UiChromeContext.Provider>
  );
}

export function useUiChrome() {
  const ctx = useContext(UiChromeContext);
  if (!ctx) {
    throw new Error("useUiChrome must be used within UiChromeProvider");
  }
  return ctx;
}
