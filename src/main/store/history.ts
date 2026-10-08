import type { HistoryEntry } from "@shared/contract";
import { JsonFile } from "./jsonFile";

interface HistoryDoc {
  entries: HistoryEntry[];
}

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
    this.file.write({ entries: [entry, ...this.list()].slice(0, 500) });
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
    this.file.write({ entries: this.list().filter((e) => e.id !== id) });
  }
}
