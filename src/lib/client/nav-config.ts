/**
 * Shared navigation configuration for desktop sidebar and mobile drawer.
 * URLs preserved — labels are presentation only.
 */

export type NavGroupId = "trading" | "research" | "system";

export type NavIconId =
  | "overview"
  | "auto"
  | "positions"
  | "watchlist"
  | "performance"
  | "strategy"
  | "backtest"
  | "activity"
  | "settings"
  | "monitor";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconId;
  group: NavGroupId;
};

export type NavGroup = {
  id: NavGroupId;
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "trading",
    label: "Trading",
    items: [
      { href: "/dashboard", label: "Overview", icon: "overview", group: "trading" },
      { href: "/auto-trade", label: "Auto Trading", icon: "auto", group: "trading" },
      { href: "/trade", label: "Positions", icon: "positions", group: "trading" },
      { href: "/watchlist", label: "Watchlist", icon: "watchlist", group: "trading" },
      { href: "/performance", label: "Performance", icon: "performance", group: "trading" },
    ],
  },
  {
    id: "research",
    label: "Research",
    items: [
      {
        href: "/strategy-lab",
        label: "Strategy Lab",
        icon: "strategy",
        group: "research",
      },
      { href: "/backtest", label: "Backtest", icon: "backtest", group: "research" },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { href: "/logs", label: "Activity", icon: "activity", group: "system" },
      { href: "/settings", label: "Settings", icon: "settings", group: "system" },
      {
        href: "/monitor",
        label: "Advanced monitoring",
        icon: "monitor",
        group: "system",
      },
    ],
  },
];

/** Flat list for lookups / verify scripts. Includes /strategy-lab. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const PRIMARY_MOBILE_HREFS = [
  "/dashboard",
  "/auto-trade",
  "/trade",
  "/watchlist",
  "/performance",
] as const;

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/" || pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function pageTitleForPath(pathname: string): string {
  const match = ALL_NAV_ITEMS.find((item) => isNavActive(pathname, item.href));
  if (match) return match.label;
  if (pathname.startsWith("/assistant")) return "AI Assistant";
  return "TradingAI";
}
