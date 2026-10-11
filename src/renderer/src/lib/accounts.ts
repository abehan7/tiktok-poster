import { useMemo } from "react";
import type { HistoryEntry, Platform } from "@shared/contract";
import { platformOf } from "@renderer/components/Platform";
import { useAppState } from "./app-state";

/** Grouping key for posts made before multi-account support. */
export const NO_ACCOUNT = "none";

/** One account posts can belong to: connected TikTok/Instagram accounts, plus any seen only in history. */
export interface AccountRef {
  /** TikTok open ID, Instagram account ID, or NO_ACCOUNT. */
  id: string;
  platform: Platform;
  /** "@handle" when known, else the display name. */
  handle: string;
  avatarUrl: string | null;
  /** False for accounts that were disconnected but still have posts. */
  connected: boolean;
  /** Why the saved login no longer works, if it doesn't. */
  loginProblem: string | null;
}

export const accountKey = (e: Pick<HistoryEntry, "openId">): string => e.openId ?? NO_ACCOUNT;

/** Connected accounts first (TikTok, then Instagram), then any that only appear in history. */
export function useAccountRefs(entries: HistoryEntry[]): AccountRef[] {
  const { accounts, igAccounts } = useAppState();
  return useMemo(() => {
    const refs: AccountRef[] = [
      ...accounts.map((a) => ({
        id: a.openId,
        platform: "tiktok" as const,
        handle: a.username ? `@${a.username}` : a.displayName,
        avatarUrl: a.avatarUrl,
        connected: true,
        loginProblem: a.loginProblem,
      })),
      ...igAccounts.map((a) => ({
        id: a.id,
        platform: "instagram" as const,
        handle: `@${a.username}`,
        avatarUrl: a.avatarUrl,
        connected: true,
        loginProblem: a.loginProblem,
      })),
    ];
    const seen = new Set(refs.map((r) => r.id));
    for (const e of entries) {
      const id = accountKey(e);
      if (seen.has(id)) continue;
      seen.add(id);
      refs.push({
        id,
        platform: platformOf(e),
        handle: id === NO_ACCOUNT ? "Unassigned" : (e.accountName ?? "Unknown account"),
        avatarUrl: null,
        connected: false,
        loginProblem: null,
      });
    }
    return refs;
  }, [accounts, igAccounts, entries]);
}

/** Buckets items by account, in the order of `refs`, dropping empty accounts. */
export function groupByAccount<T>(refs: AccountRef[], items: T[], entryOf: (item: T) => HistoryEntry): { ref: AccountRef; items: T[] }[] {
  const m = new Map<string, T[]>();
  for (const item of items) {
    const k = accountKey(entryOf(item));
    m.set(k, [...(m.get(k) ?? []), item]);
  }
  return refs.filter((r) => m.has(r.id)).map((ref) => ({ ref, items: m.get(ref.id)! }));
}
