import { NextResponse } from "next/server";
import { getAppSettingsView } from "@/lib/settings/view";

export const dynamic = "force-dynamic";

/**
 * Read-only settings snapshot from server env.
 * UI drafts may be stored in localStorage; they do not override safety gates.
 */
export async function GET() {
  return NextResponse.json(getAppSettingsView());
}
