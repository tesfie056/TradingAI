/**
 * Client-only sidebar collapse preference (localStorage).
 */

const KEY = "tradingai.sidebarCollapsed.v1";

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function getSidebarCollapsedSnapshot(): boolean {
  if (cached == null) cached = read();
  return cached;
}

export function getSidebarCollapsedServerSnapshot(): boolean {
  return false;
}

export function setSidebarCollapsed(next: boolean): void {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function subscribeSidebarCollapsed(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleSidebarCollapsed(): void {
  setSidebarCollapsed(!getSidebarCollapsedSnapshot());
}

/** First visit on tablet/narrow desktop: prefer collapsed rail. */
export function ensureSidebarDefaultForViewport(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(KEY) != null) return;
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setSidebarCollapsed(true);
    }
  } catch {
    /* ignore */
  }
}
