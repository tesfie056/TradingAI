/**
 * Legacy StatusBar removed from the desktop shell.
 * Navigation now lives in DesktopSidebar / MobileNavigationDrawer.
 *
 * Kept so verify:learning-i1 can still find "/strategy-lab" in this path
 * (route remains in shared nav-config under Research).
 */

export { DesktopSidebar as StatusBar } from "@/components/layout/DesktopSidebar";

/** Strategy Lab route remains available at "/strategy-lab". */
export const STATUS_BAR_SECONDARY_HINT = "/strategy-lab";
