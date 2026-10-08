import { useCallback, useEffect, useState } from "react";
import type { HistoryEntry } from "@shared/contract";
import { errorMessage, poster } from "./api";

/** Live post history plus the per-post actions, shared by History and Calendar. */
export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void poster.listHistory().then(setEntries);
    const off = poster.onHistory((e) =>
      setEntries((cur) => (cur.some((x) => x.id === e.id) ? cur.map((x) => (x.id === e.id ? e : x)) : [e, ...cur])),
    );
    // Re-render every 30s so "Delayed" / "in 5 min" stay current.
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const act = useCallback(async (id: string, work: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await work();
      if (r && typeof r === "object" && "id" in r) {
        const e = r as HistoryEntry;
        setEntries((cur) => cur.map((x) => (x.id === e.id ? e : x)));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  return {
    entries,
    now,
    busyId,
    error,
    refresh: (id: string) => act(id, () => poster.refreshStatus(id)),
    remove: async (id: string) => {
      await poster.removeHistory(id);
      setEntries((cur) => cur.filter((x) => x.id !== id));
    },
    postNow: (id: string) => act(id, () => poster.postScheduledNow(id)),
    cancel: (id: string) => act(id, () => poster.cancelScheduled(id)),
    reschedule: (id: string, at: string) => act(id, () => poster.reschedule(id, at)),
    setFinished: (id: string, finished: boolean) => act(id, () => poster.setFinished(id, finished)),
  };
}

export type HistoryApi = ReturnType<typeof useHistory>;
