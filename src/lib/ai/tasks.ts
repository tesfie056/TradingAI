/**
 * AI Assistant background tasks.
 * Analyze / explain only — never places orders or calls submit-paper.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAiCommand, scrubSecrets } from "@/lib/ai/command";
import type { AiCommandRequest } from "@/lib/ai/command-types";
import type { AiTaskRecord } from "@/lib/ai/task-types";
import { isPaperOrderExecutionEnabled } from "@/lib/config";

export type { AiTaskRecord, AiTaskStatus } from "@/lib/ai/task-types";

type CreateTaskInput = {
  userInstruction: string;
  selectedSymbol?: string | null;
  conversation?: AiCommandRequest["conversation"];
  context?: AiCommandRequest["context"];
};

type InternalTask = AiTaskRecord & {
  conversation: AiCommandRequest["conversation"];
  context: AiCommandRequest["context"];
  cancelRequested: boolean;
};

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "ai-tasks.jsonl");
const MAX_TASKS = 120;
const globalKey = "__tradingai_ai_tasks__";

type Store = {
  tasks: Map<string, InternalTask>;
};

function getStore(): Store {
  const g = globalThis as typeof globalThis & { [globalKey]?: Store };
  if (!g[globalKey]) {
    g[globalKey] = { tasks: new Map() };
  }
  return g[globalKey]!;
}

function newTaskId(): string {
  return `ait_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toPublic(task: InternalTask): AiTaskRecord {
  return {
    taskId: task.taskId,
    question: task.question,
    selectedSymbol: task.selectedSymbol,
    status: task.status,
    answer: task.answer,
    relatedSymbols: task.relatedSymbols,
    suggestedAction: task.suggestedAction,
    safetyWarnings: task.safetyWarnings,
    tradePreviewAllowed: task.tradePreviewAllowed,
    previewHint: task.previewHint,
    provider: task.provider,
    usedFallback: task.usedFallback,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    error: task.error,
    paperOnly: true,
    liveTradingAllowed: false,
    automaticTradingAllowed: false,
    canSubmitOrders: false,
  };
}

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

async function appendTaskLog(task: AiTaskRecord): Promise<void> {
  try {
    await ensureDir();
    await writeFile(FILE, `${JSON.stringify(task)}\n`, { flag: "a" });
  } catch {
    /* ignore disk errors — in-memory still works */
  }
}

async function pruneTaskLog(): Promise<void> {
  try {
    const raw = await readFile(FILE, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length <= MAX_TASKS) return;
    await writeFile(FILE, `${lines.slice(-MAX_TASKS).join("\n")}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

function assertNoOrderApisInContext(context: AiCommandRequest["context"]): void {
  const blob = JSON.stringify(context ?? {});
  if (/submit-paper|placePaperOrder|ALPACA_SECRET|FINNHUB_API_KEY/i.test(blob)) {
    throw new Error("Context rejected: secrets or order APIs are not allowed.");
  }
}

export function createAiTask(input: CreateTaskInput): AiTaskRecord {
  const question = scrubSecrets(input.userInstruction.trim());
  if (!question) {
    throw new Error("userInstruction is required");
  }
  assertNoOrderApisInContext(input.context);

  const now = new Date().toISOString();
  const task: InternalTask = {
    taskId: newTaskId(),
    question,
    selectedSymbol: input.selectedSymbol?.trim().toUpperCase() || null,
    status: "pending",
    answer: null,
    relatedSymbols: [],
    suggestedAction: null,
    safetyWarnings: [
      "PAPER TRADE ONLY",
      "AI never submits orders",
      "Manual confirmation required for paper trades",
    ],
    tradePreviewAllowed: false,
    previewHint: null,
    provider: null,
    usedFallback: false,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    paperOnly: true,
    liveTradingAllowed: false,
    automaticTradingAllowed: false,
    canSubmitOrders: false,
    conversation: input.conversation ?? null,
    context: input.context ?? {},
    cancelRequested: false,
  };

  const store = getStore();
  store.tasks.set(task.taskId, task);
  void appendTaskLog(toPublic(task));

  // Fire-and-forget background run — survives client navigation.
  void runTask(task.taskId);

  return toPublic(task);
}

async function runTask(taskId: string): Promise<void> {
  const store = getStore();
  const task = store.tasks.get(taskId);
  if (!task) return;
  if (task.cancelRequested) {
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    task.error = "Cancelled before start";
    void appendTaskLog(toPublic(task));
    return;
  }

  task.status = "running";
  task.startedAt = new Date().toISOString();

  try {
    const result = await runAiCommand({
      userInstruction: task.question,
      selectedSymbol: task.selectedSymbol,
      conversation: task.conversation,
      context: task.context,
    });

    const latest = store.tasks.get(taskId);
    if (!latest) return;
    if (latest.cancelRequested) {
      latest.status = "cancelled";
      latest.completedAt = new Date().toISOString();
      latest.error = "Cancelled while running";
      void appendTaskLog(toPublic(latest));
      return;
    }

    latest.status = "completed";
    latest.answer = scrubSecrets(result.answer);
    latest.relatedSymbols = result.relatedSymbols;
    latest.suggestedAction = result.suggestedAction;
    latest.safetyWarnings = result.safetyWarnings;
    latest.tradePreviewAllowed = result.tradePreviewAllowed;
    latest.previewHint = result.previewHint;
    latest.provider = result.provider;
    latest.usedFallback = result.usedFallback;
    latest.completedAt = new Date().toISOString();
    latest.error = null;
    void appendTaskLog(toPublic(latest));
    void pruneTaskLog();
  } catch (err) {
    const latest = store.tasks.get(taskId);
    if (!latest) return;
    latest.status = latest.cancelRequested ? "cancelled" : "failed";
    latest.completedAt = new Date().toISOString();
    latest.error = scrubSecrets(
      err instanceof Error ? err.message : "AI task failed",
    );
    void appendTaskLog(toPublic(latest));
  }
}

export function getAiTask(taskId: string): AiTaskRecord | null {
  const task = getStore().tasks.get(taskId);
  return task ? toPublic(task) : null;
}

export function listAiTasks(limit = 40): AiTaskRecord[] {
  const all = [...getStore().tasks.values()].map(toPublic);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all.slice(0, Math.max(1, Math.min(100, limit)));
}

export function cancelAiTask(taskId: string): AiTaskRecord | null {
  const task = getStore().tasks.get(taskId);
  if (!task) return null;
  if (task.status === "completed" || task.status === "failed") {
    return toPublic(task);
  }
  task.cancelRequested = true;
  if (task.status === "pending") {
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    task.error = "Cancelled";
    void appendTaskLog(toPublic(task));
  }
  // running: runner will flip to cancelled when it checks
  return toPublic(task);
}

export function retryAiTask(taskId: string): AiTaskRecord | null {
  const prev = getStore().tasks.get(taskId);
  if (!prev) return null;
  return createAiTask({
    userInstruction: prev.question,
    selectedSymbol: prev.selectedSymbol,
    conversation: prev.conversation,
    context: prev.context,
  });
}

export function deleteAiTask(taskId: string): boolean {
  return getStore().tasks.delete(taskId);
}

export function aiTaskSafetyFlags() {
  return {
    paperOnly: true as const,
    liveTradingAllowed: false as const,
    automaticTradingAllowed: false as const,
    canSubmitOrders: false as const,
    orderExecutionEnabled: isPaperOrderExecutionEnabled(),
  };
}
