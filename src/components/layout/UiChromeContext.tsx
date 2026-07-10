"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  loadUiSettings,
  saveUiSettings,
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
};

const UiChromeContext = createContext<UiChromeValue | null>(null);

export function UiChromeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewModeState] = useState<UiViewMode>(() =>
    typeof window === "undefined" ? "simple" : loadUiSettings().viewMode,
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeed, setAiSeed] = useState<string | null>(null);

  const setViewMode = useCallback((mode: UiViewMode) => {
    setViewModeState(mode);
    const ui = loadUiSettings();
    saveUiSettings({ ...ui, viewMode: mode });
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode(viewMode === "simple" ? "advanced" : "simple");
  }, [setViewMode, viewMode]);

  const openAi = useCallback((seed?: string | null) => {
    setAiSeed(seed ?? null);
    setAiOpen(true);
  }, []);

  const closeAi = useCallback(() => {
    setAiOpen(false);
    setAiSeed(null);
  }, []);

  const value = useMemo(
    () => ({
      viewMode,
      setViewMode,
      toggleViewMode,
      aiOpen,
      openAi,
      closeAi,
      aiSeed,
    }),
    [viewMode, setViewMode, toggleViewMode, aiOpen, openAi, closeAi, aiSeed],
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
