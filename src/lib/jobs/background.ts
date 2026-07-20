/**
 * Lightweight background jobs for long analyses (Milestone I-4).
 * GET handlers never start expensive work — only POST + poll.
 */

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "jobs");

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type BackgroundJob = {
  id: string;
  type: string;
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  result: unknown;
  error: string | null;
};

async function writeAtomic(file: string, data: unknown) {
  await mkdir(DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export async function createJob(type: string): Promise<BackgroundJob> {
  const job: BackgroundJob = {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    status: "queued",
    progress: 0,
    message: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: null,
  };
  await writeAtomic(path.join(DIR, `${job.id}.json`), job);
  return job;
}

export async function updateJob(
  id: string,
  patch: Partial<BackgroundJob>,
): Promise<BackgroundJob | null> {
  const job = await readJob(id);
  if (!job) return null;
  if (job.status === "cancelled") return job;
  const next = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeAtomic(path.join(DIR, `${id}.json`), next);
  return next;
}

export async function readJob(id: string): Promise<BackgroundJob | null> {
  try {
    const raw = await readFile(path.join(DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as BackgroundJob;
  } catch {
    return null;
  }
}

export async function cancelJob(id: string): Promise<BackgroundJob | null> {
  return updateJob(id, { status: "cancelled", message: "cancelled by user" });
}

/**
 * Run async work with progress callbacks. Does not block HTTP beyond enqueue.
 */
export function runJobInBackground(
  jobId: string,
  work: (ctx: {
    progress: (pct: number, message: string) => Promise<void>;
    isCancelled: () => Promise<boolean>;
  }) => Promise<unknown>,
): void {
  void (async () => {
    await updateJob(jobId, { status: "running", progress: 1, message: "started" });
    try {
      const result = await work({
        progress: async (pct, message) => {
          const j = await readJob(jobId);
          if (j?.status === "cancelled") return;
          await updateJob(jobId, {
            progress: Math.min(99, Math.max(0, pct)),
            message,
            status: "running",
          });
        },
        isCancelled: async () => {
          const j = await readJob(jobId);
          return j?.status === "cancelled";
        },
      });
      const j = await readJob(jobId);
      if (j?.status === "cancelled") return;
      await updateJob(jobId, {
        status: "completed",
        progress: 100,
        message: "completed",
        result,
      });
    } catch (e) {
      await updateJob(jobId, {
        status: "failed",
        message: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
}
