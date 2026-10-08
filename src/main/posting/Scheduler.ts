import { app, nativeImage, powerSaveBlocker } from "electron";
import { constants } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { HistoryEntry, PhotoPostInput, VideoPostInput } from "@shared/contract";
import { toLocalFile } from "../media";
import type { HistoryStore } from "../store/history";
import { JsonFile } from "../store/jsonFile";
import type { PostingService } from "./PostingService";

type Job =
  | { entryId: string; kind: "video"; input: VideoPostInput }
  | { entryId: string; kind: "photo"; input: PhotoPostInput };

interface JobsDoc {
  jobs: Job[];
}

const TICK_MS = 15_000;
/** A post this overdue (app was closed) is marked missed instead of going out late. */
const MAX_LATE_MS = 12 * 3600_000;
const MIN_LEAD_MS = 30_000;

/**
 * Posts scheduled jobs while the app is running (the window may be closed).
 * Each job's files are cloned into userData at schedule time, so editing or
 * deleting the originals afterwards doesn't change what goes out.
 */
export class Scheduler {
  private readonly file = new JsonFile<JobsDoc>("schedules.json", () => ({ jobs: [] }));
  private readonly running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private blocker: number | null = null;

  constructor(
    private readonly posting: PostingService,
    private readonly history: HistoryStore,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  /** Scheduled posts still waiting to go out. */
  pendingCount(): number {
    return this.jobs().filter((j) => this.history.get(j.entryId)?.status === "SCHEDULED").length;
  }

  async scheduleVideo(input: VideoPostInput, at: string): Promise<HistoryEntry> {
    const when = parseFuture(at);
    await this.posting.validateVideo(input);
    const entry = this.posting.createEntry(
      input.openId,
      { kind: "video", mode: input.mode, label: input.mode === "DIRECT" && input.title ? input.title : basename(input.filePath), thumbUrl: null },
      when,
    );
    const [filePath] = await this.stashOrRollback(entry.id, [input.filePath]);
    this.save({ entryId: entry.id, kind: "video", input: { ...input, filePath } });
    return this.withJob(entry);
  }

  async schedulePhotos(input: PhotoPostInput, at: string): Promise<HistoryEntry> {
    const when = parseFuture(at);
    this.posting.validatePhotos(input);
    const entry = this.posting.createEntry(
      input.openId,
      {
        kind: "photo",
        mode: input.mode,
        label: input.title || input.description.split("\n")[0] || `${input.filePaths.length} photos`,
        thumbUrl: null,
      },
      when,
    );
    const filePaths = await this.stashOrRollback(entry.id, input.filePaths);
    this.save({ entryId: entry.id, kind: "photo", input: { ...input, filePaths } });
    return this.withJob(this.posting.update(entry.id, { thumbUrl: toLocalFile(filePaths[0]).url }));
  }

  reschedule(entryId: string, at: string): HistoryEntry {
    const when = parseFuture(at);
    this.requireJob(entryId);
    const e = this.history.get(entryId);
    if (e?.status !== "SCHEDULED" && e?.status !== "FAILED") throw new Error("Only scheduled or missed posts can be rescheduled.");
    return this.posting.update(entryId, { status: "SCHEDULED", scheduledAt: when, failReason: null });
  }

  async cancel(entryId: string): Promise<HistoryEntry> {
    this.requireJob(entryId);
    if (this.running.has(entryId)) throw new Error("That post is already uploading.");
    await this.drop(entryId);
    return this.posting.update(entryId, { status: "CANCELLED", failReason: null });
  }

  async postNow(entryId: string): Promise<void> {
    this.requireJob(entryId);
    await this.fire(entryId);
  }

  /** Marks entries that still have a job (so the UI can offer Post now / Reschedule). */
  decorate(entries: HistoryEntry[]): HistoryEntry[] {
    const ids = new Set(this.jobs().map((j) => j.entryId));
    return entries.map((e) => (ids.has(e.id) ? { ...e, hasJob: true } : e));
  }

  /** Asks before quitting while posts are still waiting. */
  confirmQuit(ask: (pending: number) => boolean): boolean {
    const pending = this.pendingCount();
    return pending === 0 || ask(pending);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const job of this.jobs()) {
      const e = this.history.get(job.entryId);
      if (!e) {
        await this.drop(job.entryId); // removed from history
        continue;
      }
      if (e.status !== "SCHEDULED" || !e.scheduledAt || this.running.has(e.id)) continue;
      const due = Date.parse(e.scheduledAt);
      if (due > now) continue;
      if (now - due > MAX_LATE_MS) {
        this.posting.update(e.id, {
          status: "FAILED",
          failReason: `Missed: TikTok Poster wasn't running at ${new Date(due).toLocaleString()}. Post now or reschedule.`,
        });
        continue;
      }
      void this.fire(e.id);
    }
    this.syncPowerBlocker();
  }

  private async fire(entryId: string): Promise<void> {
    if (this.running.has(entryId)) return;
    const job = this.requireJob(entryId);
    this.running.add(entryId);
    try {
      if (job.kind === "video") await this.posting.postVideo(job.input, entryId);
      else await this.posting.postPhotos(job.input, entryId);
      // Sent: TikTok has the video / the images are on R2, so the copies can go (keep a thumbnail).
      if (job.kind === "photo") await this.keepThumb(entryId, job.input.filePaths[job.input.coverIndex] ?? job.input.filePaths[0]);
      await this.drop(entryId);
    } catch {
      // PostingService already marked the entry FAILED with the reason; keep the job for Post now.
    } finally {
      this.running.delete(entryId);
      this.syncPowerBlocker();
    }
  }

  /** Keep macOS App Nap from delaying timers while something is waiting. */
  private syncPowerBlocker() {
    const pending = this.pendingCount() > 0 || this.running.size > 0;
    if (pending && this.blocker === null) this.blocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!pending && this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker);
      this.blocker = null;
    }
  }

  private async stashOrRollback(entryId: string, paths: string[]): Promise<string[]> {
    try {
      return await this.stash(entryId, paths);
    } catch (err) {
      this.history.remove(entryId);
      await rm(this.dirFor(entryId), { recursive: true, force: true });
      throw new Error(`Couldn't save the files for later: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Clones (APFS copy-on-write, else copies) the job's files into userData/scheduled/<id>/. */
  private async stash(entryId: string, paths: string[]): Promise<string[]> {
    const dir = this.dirFor(entryId);
    await mkdir(dir, { recursive: true });
    return Promise.all(
      paths.map(async (p, i) => {
        const dest = join(dir, `${String(i + 1).padStart(2, "0")}-${basename(p)}`);
        await copyFile(p, dest, constants.COPYFILE_FICLONE);
        return dest;
      }),
    );
  }

  /** Small JPEG of the cover in userData/thumbs, so History keeps a picture after the copies are removed. */
  private async keepThumb(entryId: string, source: string) {
    try {
      const dir = join(app.getPath("userData"), "thumbs");
      await mkdir(dir, { recursive: true });
      const img = nativeImage.createFromPath(source);
      if (img.isEmpty()) return;
      const dest = join(dir, `${entryId}.jpg`);
      await writeFile(dest, img.resize({ width: 240 }).toJPEG(80));
      this.posting.update(entryId, { thumbUrl: toLocalFile(dest).url });
    } catch {
      // cosmetic only
    }
  }

  private dirFor(entryId: string) {
    return join(app.getPath("userData"), "scheduled", entryId);
  }

  private async drop(entryId: string) {
    this.file.write({ jobs: this.jobs().filter((j) => j.entryId !== entryId) });
    await rm(this.dirFor(entryId), { recursive: true, force: true });
  }

  private jobs(): Job[] {
    return this.file.read().jobs;
  }

  private save(job: Job) {
    this.file.write({ jobs: [...this.jobs().filter((j) => j.entryId !== job.entryId), job] });
    this.syncPowerBlocker();
  }

  private requireJob(entryId: string): Job {
    const job = this.jobs().find((j) => j.entryId === entryId);
    if (!job) throw new Error("This post has no saved schedule (already sent or cancelled).");
    return job;
  }

  private withJob(e: HistoryEntry): HistoryEntry {
    return { ...e, hasJob: true };
  }
}

function parseFuture(at: string): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) throw new Error("Pick a valid date and time.");
  if (t < Date.now() + MIN_LEAD_MS) throw new Error("Pick a time at least a minute from now.");
  return new Date(t).toISOString();
}
