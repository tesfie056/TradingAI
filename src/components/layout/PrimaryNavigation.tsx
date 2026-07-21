/**
 * Compatibility re-exports — desktop nav uses DesktopSidebar + nav-config.
 */
export {
  ALL_NAV_ITEMS as PRIMARY_NAV_FLAT,
  isNavActive,
  NAV_GROUPS,
} from "@/lib/client/nav-config";

import { ALL_NAV_ITEMS } from "@/lib/client/nav-config";

/** @deprecated Use NAV_GROUPS from nav-config. */
export const PRIMARY_NAV = ALL_NAV_ITEMS.filter((i) => i.group === "trading");

/** @deprecated Use NAV_GROUPS from nav-config. Includes /strategy-lab. */
export const MORE_NAV = ALL_NAV_ITEMS.filter((i) => i.group !== "trading");

/** No-op placeholder — desktop navigation is the sidebar. */
export function PrimaryNavigation() {
  return null;
}
