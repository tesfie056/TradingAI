"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MonitorStatus } from "@/lib/monitor/types";

type MonitorStreamContextValue = {
  connected: boolean;
  heartbeatAt: string | null;
  status: MonitorStatus | null;
  marketOpen: boolean | null;
  workerRunning: boolean;
  scanning: boolean;
  reconnect: () => void;
};

const MonitorStreamContext = createContext<MonitorStreamContextValue>({
  connected: false,
  heartbeatAt: null,
  status: null,
  marketOpen: null,
  workerRunning: false,
  scanning: false,
  reconnect: () => {},
});

type StreamPayload = {
  type: string;
  at?: string;
  status?: MonitorStatus;
  workerRunning?: boolean;
  scanning?: boolean;
  marketOpen?: boolean | null;
};

export function MonitorStreamProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [heartbeatAt, setHeartbeatAt] = useState<string | null>(null);
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [workerRunning, setWorkerRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reconnect = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    const connect = () => {
      source = new EventSource("/api/monitor/stream");
      source.onopen = () => {
        if (!cancelled) setConnected(true);
      };
      source.onmessage = (event) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(event.data as string) as StreamPayload;
          if (data.at) setHeartbeatAt(data.at);
          if (data.type === "heartbeat") {
            setWorkerRunning(Boolean(data.workerRunning));
            setScanning(Boolean(data.scanning));
            if (data.marketOpen !== undefined) setMarketOpen(data.marketOpen);
          }
          if (
            (data.type === "status" || data.type === "scan_completed") &&
            data.status
          ) {
            setStatus(data.status);
            setWorkerRunning(data.status.running);
            // Prefer authoritative status payload; paused engine is never "scanning".
            setScanning(
              Boolean(data.status.scanning) && !data.status.enginePaused,
            );
            if (data.status.marketOpen !== undefined) {
              setMarketOpen(data.status.marketOpen);
            }
          }
        } catch {
          // ignore malformed events
        }
      };
      source.onerror = () => {
        if (!cancelled) {
          setConnected(false);
          // Do not keep a sticky Scanning state across reconnect gaps.
          setScanning(false);
        }
        source?.close();
        window.setTimeout(() => {
          if (!cancelled) connect();
        }, 3000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      source?.close();
      setConnected(false);
    };
  }, [nonce]);

  const value = useMemo(
    () => ({
      connected,
      heartbeatAt,
      status,
      marketOpen,
      workerRunning,
      scanning,
      reconnect,
    }),
    [
      connected,
      heartbeatAt,
      status,
      marketOpen,
      workerRunning,
      scanning,
      reconnect,
    ],
  );

  return (
    <MonitorStreamContext.Provider value={value}>
      {children}
    </MonitorStreamContext.Provider>
  );
}

export function useMonitorStream(): MonitorStreamContextValue {
  return useContext(MonitorStreamContext);
}
