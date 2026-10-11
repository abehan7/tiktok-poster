import type { HistoryEntry } from "@shared/contract";
import { JsonFile } from "./jsonFile";

interface HistoryDoc {
  entries: HistoryEntry[];
}

const KEEP = 500;
/** Scheduled posts and TikTok drafts not yet marked posted. */
const waiting = (e: HistoryEntry) => e.status === "SCHEDULED" || (e.status === "SEND_TO_USER_INBOX" && !e.finishedAt);

/** Post history, newest first. Small enough to rewrite on every change. */
export class HistoryStore {
  private readonly file = new JsonFile<HistoryDoc>("history.json", () => ({ entries: [] }));

  list(): HistoryEntry[] {
    return this.file.read().entries;
  }

  get(id: string): HistoryEntry | undefined {
    return this.list().find((e) => e.id === id);
  }

  add(entry: HistoryEntry): void {
    // Keep the newest 500, but never drop a post that's still waiting: the scheduler deletes any job whose
    // entry is gone, and bulk imports create entries days before they go out.
    const all = [entry, ...this.list()];
    this.file.write({ entries: all.filter((e, i) => i < KEEP || waiting(e)) });
  }

  update(id: string, patch: Partial<HistoryEntry>): HistoryEntry {
    const entries = this.list();
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) throw new Error(`Unknown history entry ${id}`);
    entries[i] = { ...entries[i], ...patch, updatedAt: new Date().toISOString() };
    this.file.write({ entries });
    return entries[i];
  }

  remove(id: string): void {
    this.removeMany([id]);
  }

  removeMany(ids: string[]): void {
    const drop = new Set(ids);
    this.file.write({ entries: this.list().filter((e) => !drop.has(e.id)) });
  }
}
