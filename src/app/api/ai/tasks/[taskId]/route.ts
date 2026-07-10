import { NextResponse } from "next/server";
import {
  aiTaskSafetyFlags,
  cancelAiTask,
  deleteAiTask,
  getAiTask,
  retryAiTask,
} from "@/lib/ai/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ taskId: string }> };

/** GET one task — poll while pending/running. */
export async function GET(_request: Request, { params }: Params) {
  const { taskId } = await params;
  const task = getAiTask(taskId);
  if (!task) {
    return NextResponse.json(
      { error: "Task not found", ...aiTaskSafetyFlags() },
      { status: 404 },
    );
  }
  return NextResponse.json({ ...aiTaskSafetyFlags(), task });
}

/** DELETE task from memory (optional). */
export async function DELETE(_request: Request, { params }: Params) {
  const { taskId } = await params;
  const ok = deleteAiTask(taskId);
  return NextResponse.json({ ok, ...aiTaskSafetyFlags() }, { status: ok ? 200 : 404 });
}

/**
 * POST actions: { action: "cancel" | "retry" }
 */
export async function POST(request: Request, { params }: Params) {
  const { taskId } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
    };
    const action = body.action ?? "cancel";

    if (action === "cancel") {
      const task = cancelAiTask(taskId);
      if (!task) {
        return NextResponse.json(
          { error: "Task not found", ...aiTaskSafetyFlags() },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, ...aiTaskSafetyFlags(), task });
    }

    if (action === "retry") {
      const task = retryAiTask(taskId);
      if (!task) {
        return NextResponse.json(
          { error: "Task not found", ...aiTaskSafetyFlags() },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, ...aiTaskSafetyFlags(), task });
    }

    return NextResponse.json(
      { error: "Unknown action", ...aiTaskSafetyFlags() },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Task action failed",
        ...aiTaskSafetyFlags(),
      },
      { status: 500 },
    );
  }
}
