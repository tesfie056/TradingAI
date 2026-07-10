"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/client/fetch-json";
import { buildAiContextSnapshot } from "@/lib/client/ai-context";
import {
  DEFAULT_POPUP_GEOMETRY,
  formatTaskStatusLabel,
  loadActiveTaskId,
  loadPopupChat,
  loadPopupGeometry,
  saveActiveTaskId,
  savePopupChat,
  savePopupGeometry,
  type AiChatTurn,
  type AiPopupGeometry,
} from "@/lib/client/ai-popup";
import { useUiChrome } from "@/components/layout/UiChromeContext";
import type { AiTaskRecord } from "@/lib/ai/task-types";
import { SafetyStrip } from "@/components/ui/SafetyStrip";

const QUICK_ACTIONS = [
  "What can I ask?",
  "Analyze my watchlist",
  "Explain today's strongest stock",
  "Explain why all trades are blocked",
  "Find highest confidence setup",
  "Summarize market/news risk",
  "Prepare paper trade preview",
] as const;

type TaskListResponse = {
  tasks: AiTaskRecord[];
};

type TaskResponse = {
  task: AiTaskRecord;
  taskId?: string;
};

function newTurnId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.floor(Math.random() * 1e9)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function AiAssistantPopup() {
  const router = useRouter();
  const { aiOpen, closeAi, aiSeed, openAi, setAiIndicator } = useUiChrome();
  const [geo, setGeo] = useState<AiPopupGeometry>(DEFAULT_POPUP_GEOMETRY);
  const [ready, setReady] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [turns, setTurns] = useState<AiChatTurn[]>([]);
  const [tasks, setTasks] = useState<AiTaskRecord[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AiTaskRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderExecutionEnabled, setOrderExecutionEnabled] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const geoRef = useRef(geo);
  const aiOpenRef = useRef(aiOpen);
  const dragRef = useRef<{
    ox: number;
    oy: number;
    sx: number;
    sy: number;
  } | null>(null);
  const resizeRef = useRef<{
    ox: number;
    oy: number;
    sw: number;
    sh: number;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    geoRef.current = geo;
  }, [geo]);

  useEffect(() => {
    aiOpenRef.current = aiOpen;
  }, [aiOpen]);

  // Hydrate geometry + chat after mount (avoid SSR mismatch)
  useEffect(() => {
    const boot = window.setTimeout(() => {
      setGeo(loadPopupGeometry());
      setTurns(loadPopupChat());
      setActiveTaskId(loadActiveTaskId());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(boot);
  }, []);

  useEffect(() => {
    if (!aiSeed) return;
    const t = window.setTimeout(() => setInstruction(aiSeed), 0);
    return () => window.clearTimeout(t);
  }, [aiSeed]);

  const persistTurns = useCallback((next: AiChatTurn[]) => {
    setTurns(next);
    savePopupChat(next);
  }, []);

  const refreshTaskList = useCallback(async () => {
    try {
      const res = await fetchJson<TaskListResponse>("/api/ai/tasks?limit=20");
      setTasks(res.tasks ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  // Poll active task even when popup is closed or minimized — survives navigation.
  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetchJson<TaskResponse>(
          `/api/ai/tasks/${encodeURIComponent(activeTaskId!)}`,
        );
        if (cancelled) return;
        const task = res.task;
        setActiveTask(task);

        const thinking =
          task.status === "pending" || task.status === "running";
        if (thinking) {
          setAiIndicator({ thinking: true, resultsReady: 0 });
        }

        setTurns((prev) => {
          const next = prev.map((t) => {
            if (t.taskId !== task.taskId) return t;
            if (t.role === "user") {
              return { ...t, status: task.status };
            }
            if (t.role === "assistant") {
              return {
                ...t,
                text:
                  task.status === "completed"
                    ? (task.answer ?? t.text)
                    : task.status === "failed"
                      ? (task.error ?? "Task failed")
                      : task.status === "cancelled"
                        ? "Canceled."
                        : "Thinking…",
                status: task.status,
                relatedSymbols: task.relatedSymbols,
                safetyWarnings: task.safetyWarnings,
                error: task.error,
              };
            }
            return t;
          });
          if (
            !next.some(
              (t) => t.role === "assistant" && t.taskId === task.taskId,
            )
          ) {
            next.push({
              id: `a-${task.taskId}`,
              role: "assistant",
              text:
                task.status === "completed"
                  ? (task.answer ?? "")
                  : task.status === "failed"
                    ? (task.error ?? "Task failed")
                    : task.status === "cancelled"
                      ? "Canceled."
                      : "Thinking…",
              taskId: task.taskId,
              status: task.status,
              relatedSymbols: task.relatedSymbols,
              safetyWarnings: task.safetyWarnings,
              timestamp: task.completedAt ?? task.createdAt,
              error: task.error,
            });
          }
          savePopupChat(next);
          return next;
        });

        if (
          task.status === "completed" ||
          task.status === "failed" ||
          task.status === "cancelled"
        ) {
          saveActiveTaskId(null);
          setActiveTaskId(null);
          void refreshTaskList();
          setAiIndicator({
            thinking: false,
            resultsReady:
              task.status === "completed" && !aiOpenRef.current ? 1 : 0,
          });
        }
      } catch {
        /* keep polling */
      }
    }

    setAiIndicator({ thinking: true, resultsReady: 0 });
    void tick();
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeTaskId, refreshTaskList, setAiIndicator]);

  useEffect(() => {
    if (!aiOpen) return;
    const t = window.setTimeout(() => {
      void refreshTaskList();
      // Opening clears "result ready" via openAi; keep thinking if still running.
      if (activeTaskId) {
        setAiIndicator({ thinking: true, resultsReady: 0 });
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [aiOpen, refreshTaskList, activeTaskId, setAiIndicator]);

  useEffect(() => {
    if (!aiOpen || geo.minimized) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, aiOpen, geo.minimized]);

  function updateGeo(next: AiPopupGeometry) {
    geoRef.current = next;
    setGeo(next);
    savePopupGeometry(next);
  }

  function onDragStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (geo.maximized) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea")) return;

    e.preventDefault();
    const start = {
      ox: e.clientX,
      oy: e.clientY,
      sx: geoRef.current.x,
      sy: geoRef.current.y,
    };
    dragRef.current = start;

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.ox;
      const dy = ev.clientY - dragRef.current.oy;
      const next: AiPopupGeometry = {
        ...geoRef.current,
        x: clamp(dragRef.current.sx + dx, 8, window.innerWidth - 120),
        y: clamp(dragRef.current.sy + dy, 8, window.innerHeight - 48),
      };
      geoRef.current = next;
      setGeo(next);
    };

    const onUp = () => {
      dragRef.current = null;
      savePopupGeometry(geoRef.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    if (geo.maximized || geo.minimized) return;

    const start = {
      ox: e.clientX,
      oy: e.clientY,
      sw: geoRef.current.width,
      sh: geoRef.current.height,
    };
    resizeRef.current = start;

    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      const next: AiPopupGeometry = {
        ...geoRef.current,
        width: clamp(resizeRef.current.sw + (ev.clientX - resizeRef.current.ox), 320, 900),
        height: clamp(resizeRef.current.sh + (ev.clientY - resizeRef.current.oy), 360, 900),
      };
      geoRef.current = next;
      setGeo(next);
    };

    const onUp = () => {
      resizeRef.current = null;
      savePopupGeometry(geoRef.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  async function ask(text: string) {
    const userInstruction = text.trim();
    if (!userInstruction || creating) return;
    setCreating(true);
    setError(null);
    setAiIndicator({ thinking: true, resultsReady: 0 });

    const userTurn: AiChatTurn = {
      id: newTurnId("u"),
      role: "user",
      text: userInstruction,
      status: "pending",
      selectedSymbol,
      timestamp: new Date().toISOString(),
    };
    const thinkingTurn: AiChatTurn = {
      id: newTurnId("a-pending"),
      role: "assistant",
      text: "Thinking…",
      status: "pending",
      timestamp: new Date().toISOString(),
    };
    const withUser = [...turns, userTurn, thinkingTurn];
    persistTurns(withUser);

    try {
      const snap = await buildAiContextSnapshot();
      setOrderExecutionEnabled(snap.orderExecutionEnabled);
      const symbol = selectedSymbol ?? snap.selectedSymbolFallback;
      if (!selectedSymbol && symbol) setSelectedSymbol(symbol);

      const priorUser = [...turns].reverse().find((t) => t.role === "user");
      const res = await fetchJson<TaskResponse & { taskId?: string }>(
        "/api/ai/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userInstruction,
            selectedSymbol: symbol,
            conversation: {
              lastInstruction: priorUser?.text ?? null,
            },
            context: snap.context,
          }),
        },
      );

      const task = res.task;
      const taskId = task.taskId;
      setActiveTaskId(taskId);
      saveActiveTaskId(taskId);
      setActiveTask(task);

      persistTurns(
        withUser.map((t) => {
          if (t.id === userTurn.id) {
            return { ...t, taskId, status: task.status };
          }
          if (t.id === thinkingTurn.id) {
            return {
              ...t,
              id: `a-${taskId}`,
              taskId,
              status: task.status,
              text: "Thinking…",
            };
          }
          return t;
        }),
      );
      setInstruction("");
      void refreshTaskList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start AI task");
      setAiIndicator({ thinking: false, resultsReady: 0 });
      persistTurns([
        ...turns,
        userTurn,
        {
          id: newTurnId("a-err"),
          role: "assistant",
          text: err instanceof Error ? err.message : "Failed to start AI task",
          status: "failed",
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : "failed",
        },
      ]);
    } finally {
      setCreating(false);
    }
  }

  async function cancelActive() {
    if (!activeTaskId) return;
    try {
      await fetchJson(`/api/ai/tasks/${encodeURIComponent(activeTaskId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      void refreshTaskList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  async function retryTask(taskId: string) {
    try {
      const res = await fetchJson<TaskResponse>(
        `/api/ai/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "retry" }),
        },
      );
      const task = res.task;
      setActiveTaskId(task.taskId);
      saveActiveTaskId(task.taskId);
      setActiveTask(task);
      setAiIndicator({ thinking: true, resultsReady: 0 });
      persistTurns([
        ...turns,
        {
          id: newTurnId("u-retry"),
          role: "user",
          text: task.question,
          taskId: task.taskId,
          status: task.status,
          timestamp: task.createdAt,
        },
        {
          id: `a-${task.taskId}`,
          role: "assistant",
          text: "Thinking…",
          taskId: task.taskId,
          status: task.status,
          timestamp: task.createdAt,
        },
      ]);
      if (!aiOpen) openAi();
      void refreshTaskList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  }

  async function copyAnswer(turn: AiChatTurn) {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopiedId(turn.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  function clearChat() {
    persistTurns([]);
    setActiveTaskId(null);
    saveActiveTaskId(null);
    setActiveTask(null);
    setError(null);
    setAiIndicator({ thinking: false, resultsReady: 0 });
  }

  // Keep mounted for polling when closed; only hide UI.
  if (!ready) return null;

  const statusLabel = formatTaskStatusLabel(
    activeTask?.status ?? (creating ? "pending" : null),
    creating && !activeTask,
  );
  const isThinking =
    creating ||
    activeTask?.status === "pending" ||
    activeTask?.status === "running" ||
    Boolean(activeTaskId);

  if (!aiOpen) return null;

  const style = geo.maximized
    ? {
        left: 16,
        top: 16,
        width: "calc(100vw - 32px)",
        height: "calc(100vh - 32px)",
      }
    : {
        left: geo.x,
        top: geo.y,
        width: geo.width,
        height: geo.minimized ? 48 : geo.height,
      };

  const running = tasks.filter(
    (t) => t.status === "pending" || t.status === "running",
  );
  const recent = tasks.filter(
    (t) =>
      t.status === "completed" ||
      t.status === "failed" ||
      t.status === "cancelled",
  );

  return (
    <div
      className="fixed z-[80] flex flex-col overflow-hidden rounded-[var(--radius)] border border-amber-500/40 bg-[var(--panel)] shadow-2xl shadow-black/50"
      style={style}
      role="dialog"
      aria-label="AI Assistant"
    >
      <div
        className="flex cursor-grab touch-none select-none items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 active:cursor-grabbing"
        onPointerDown={onDragStart}
      >
        <div className="min-w-0 pointer-events-none">
          <p className="text-sm font-semibold">AI Assistant</p>
          <p className="text-xs text-[var(--muted)]">
            status:{" "}
            <span
              className={
                statusLabel === "Thinking"
                  ? "text-amber-200"
                  : statusLabel === "Failed"
                    ? "text-rose-200"
                    : statusLabel === "Completed"
                      ? "text-emerald-200"
                      : statusLabel === "Canceled"
                        ? "text-[var(--muted)]"
                        : ""
              }
            >
              {statusLabel}
            </span>
            {selectedSymbol ? ` · ${selectedSymbol}` : ""}
            {isThinking && geo.minimized ? " · working…" : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--panel)]"
            onClick={() =>
              updateGeo({
                ...geo,
                minimized: !geo.minimized,
                maximized: false,
              })
            }
          >
            {geo.minimized ? "Restore" : "Min"}
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--panel)]"
            onClick={() =>
              updateGeo({
                ...geo,
                maximized: !geo.maximized,
                minimized: false,
              })
            }
          >
            {geo.maximized ? "Window" : "Max"}
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--panel)]"
            onClick={() => closeAi()}
          >
            Close
          </button>
        </div>
      </div>

      {!geo.minimized ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <SafetyStrip
            orderExecutionEnabled={orderExecutionEnabled}
            compact
          />
          <p className="text-xs text-[var(--muted)]">
            Paper only · AI never submits orders · stays open across pages
          </p>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)]/60 bg-[var(--background)]/30 p-2">
            {turns.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Ask about your watchlist, blocks, or paper preview suggestions.
              </p>
            ) : (
              turns.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-[var(--radius-sm)] px-2.5 py-2 text-sm ${
                    t.role === "user"
                      ? "ml-6 bg-amber-500/15"
                      : "mr-4 bg-[var(--panel-elevated)]/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      {t.role}
                      {t.status
                        ? ` · ${formatTaskStatusLabel(t.status)}`
                        : ""}
                    </p>
                    {t.role === "assistant" && t.status === "completed" ? (
                      <button
                        type="button"
                        className="text-[10px] underline text-amber-100"
                        onClick={() => void copyAnswer(t)}
                      >
                        {copiedId === t.id ? "Copied" : "Copy answer"}
                      </button>
                    ) : null}
                    {t.role === "assistant" &&
                    t.status === "failed" &&
                    t.taskId ? (
                      <button
                        type="button"
                        className="text-[10px] underline text-amber-100"
                        onClick={() => void retryTask(t.taskId!)}
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                    {t.text}
                  </p>
                  {t.relatedSymbols && t.relatedSymbols.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.relatedSymbols.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs"
                          onClick={() => setSelectedSymbol(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex flex-wrap gap-1">
            {QUICK_ACTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
                onClick={() => void ask(q)}
                disabled={creating || Boolean(activeTaskId)}
              >
                {q}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Ask the desk AI…"
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-2 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(instruction);
                }
              }}
            />
            <button
              type="button"
              disabled={creating || !instruction.trim() || Boolean(activeTaskId)}
              onClick={() => void ask(instruction)}
              className="ui-btn border border-amber-500/45 bg-amber-500/15 text-amber-50 disabled:opacity-50"
            >
              Ask
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {activeTaskId ? (
              <button
                type="button"
                onClick={() => void cancelActive()}
                className="underline text-amber-100"
              >
                Cancel running task
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearChat}
              className="underline text-[var(--muted)]"
            >
              Clear chat
            </button>
            <button
              type="button"
              onClick={() => router.push("/trade")}
              className="underline text-[var(--muted)]"
            >
              Open Trade
            </button>
          </div>

          {error ? (
            <p className="text-xs text-rose-200">{error}</p>
          ) : null}

          <div className="max-h-28 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)]/50 p-2 text-xs">
            <p className="font-semibold text-[var(--muted)]">Tasks</p>
            {running.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {running.map((t) => (
                  <li
                    key={t.taskId}
                    className="flex items-start justify-between gap-2"
                  >
                    <span className="min-w-0 truncate">
                      Thinking: {t.question.slice(0, 56)}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 underline text-amber-100"
                      onClick={() => void cancelActive()}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[var(--muted)]">No running task</p>
            )}
            <ul className="mt-2 space-y-1">
              {recent.slice(0, 6).map((t) => (
                <li
                  key={t.taskId}
                  className="flex items-start justify-between gap-2"
                >
                  <span className="min-w-0 truncate">
                    {formatTaskStatusLabel(t.status)}: {t.question.slice(0, 48)}
                  </span>
                  {t.status === "failed" ? (
                    <button
                      type="button"
                      className="shrink-0 underline text-amber-100"
                      onClick={() => void retryTask(t.taskId)}
                    >
                      Retry
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {!geo.maximized && !geo.minimized ? (
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
          onPointerDown={onResizeStart}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
