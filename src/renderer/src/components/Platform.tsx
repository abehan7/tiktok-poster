import clsx from "clsx";
import type { HistoryEntry, Platform } from "@shared/contract";

export const platformOf = (e: Pick<HistoryEntry, "platform">): Platform => e.platform ?? "tiktok";

/** Small platform glyph (lucide has no brand icons). */
export function PlatformIcon({ platform, size = 14, className }: { platform: Platform; size?: number; className?: string }) {
  return platform === "instagram" ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={clsx("text-ig", className)} aria-label="Instagram">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={clsx("text-accent", className)} aria-label="TikTok">
      <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" strokeLinecap="round" />
      <path d="M14 3c.5 2.6 2.3 4.3 5 4.5" strokeLinecap="round" />
    </svg>
  );
}

export const PLATFORM_NAMES: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram" };
