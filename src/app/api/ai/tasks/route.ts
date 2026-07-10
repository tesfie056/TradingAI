import { NextResponse } from "next/server";
import {
  aiTaskSafetyFlags,
  createAiTask,
  listAiTasks,
} from "@/lib/ai/tasks";
import type { AiCommandRequest } from "@/lib/ai/command-types";

export const dynamic = "force-dynamic";

/**
 * POST — create AI background task (returns immediately).
 * GET — list recent tasks.
 * Never submits orders.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? 40);
  return NextResponse.json({
    ...aiTaskSafetyFlags(),
    tasks: listAiTasks(limit),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AiCommandRequest;
    if (!body?.userInstruction || typeof body.userInstruction !== "string") {
      return NextResponse.json(
        { error: "userInstruction is required", ...aiTaskSafetyFlags() },
        { status: 400 },
      );
    }

    const task = createAiTask({
      userInstruction: body.userInstruction,
      selectedSymbol: body.selectedSymbol ?? null,
      conversation: body.conversation ?? null,
      context: body.context ?? {},
    });

    return NextResponse.json({
      ok: true,
      ...aiTaskSafetyFlags(),
      task,
      taskId: task.taskId,
      message: "Task created — poll GET /api/ai/tasks/:taskId for status",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to create AI task",
        ...aiTaskSafetyFlags(),
      },
      { status: 500 },
    );
  }
}
