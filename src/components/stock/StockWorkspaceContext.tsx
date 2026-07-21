"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { StockDetailsDrawer } from "@/components/stock/StockDetailsDrawer";

type StockWorkspaceContextValue = {
  openStock: (symbol: string, opts?: { intent?: "buy" | "sell" | "view" }) => void;
  closeStock: () => void;
  activeSymbol: string | null;
};

const StockWorkspaceContext = createContext<StockWorkspaceContextValue | null>(
  null,
);

export function StockWorkspaceProvider({ children }: { children: ReactNode }) {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [intent, setIntent] = useState<"buy" | "sell" | "view">("view");

  const openStock = useCallback(
    (next: string, opts?: { intent?: "buy" | "sell" | "view" }) => {
      const sym = next.trim().toUpperCase();
      if (!sym) return;
      setSymbol(sym);
      setIntent(opts?.intent ?? "view");
    },
    [],
  );

  const closeStock = useCallback(() => {
    setSymbol(null);
    setIntent("view");
  }, []);

  const value = useMemo(
    () => ({ openStock, closeStock, activeSymbol: symbol }),
    [openStock, closeStock, symbol],
  );

  return (
    <StockWorkspaceContext.Provider value={value}>
      {children}
      <StockDetailsDrawer
        symbol={symbol}
        intent={intent}
        onClose={closeStock}
        onIntentChange={setIntent}
      />
    </StockWorkspaceContext.Provider>
  );
}

export function useStockWorkspace(): StockWorkspaceContextValue {
  const ctx = useContext(StockWorkspaceContext);
  if (!ctx) {
    throw new Error("useStockWorkspace must be used within StockWorkspaceProvider");
  }
  return ctx;
}

/** Safe hook when provider may be absent (returns null). */
export function useOptionalStockWorkspace(): StockWorkspaceContextValue | null {
  return useContext(StockWorkspaceContext);
}
