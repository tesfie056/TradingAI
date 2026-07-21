"use client";

import type { StatusKey } from "@/lib/client/status-config";

/** Compact inline SVGs for global status icons (no extra dependency). */
export function StatusGlyph({
  id,
  className = "h-4 w-4",
}: {
  id: StatusKey;
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (id) {
    case "agent":
      return (
        <svg {...common}>
          <rect x="5" y="8" width="14" height="10" rx="2" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
          <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
          <path d="M12 18v2" />
        </svg>
      );
    case "safety":
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "broker":
      return (
        <svg {...common}>
          <path d="M8 12h8" />
          <path d="M10 9l-3 3 3 3" />
          <path d="M14 9l3 3-3 3" />
          <rect x="3" y="5" width="18" height="14" rx="2" />
        </svg>
      );
    case "data":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </svg>
      );
    case "market":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case "monitor":
      return (
        <svg {...common}>
          <path d="M12 4a8 8 0 0 1 8 8" />
          <path d="M12 8a4 4 0 0 1 4 4" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <path d="M4 12h2M18 12h2M12 4v2" />
        </svg>
      );
    case "scan":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h10M4 17h13" />
          <circle cx="18" cy="12" r="2" />
        </svg>
      );
    case "engine":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
        </svg>
      );
    case "execution":
      return (
        <svg {...common}>
          <path d="M7 4h7l3 3v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          <path d="M14 4v4h4" />
          <path d="M9 13h6M9 16h4" />
        </svg>
      );
    case "auto":
      return (
        <svg {...common}>
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case "ai":
      return (
        <svg {...common}>
          <path d="M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3z" />
          <path d="M18 13l.7 2.2L21 16l-2.3.7L18 19l-.7-2.3L15 16l2.3-.8L18 13z" />
        </svg>
      );
    case "errors":
      return (
        <svg {...common}>
          <path d="M12 4l9 16H3L12 4z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}
