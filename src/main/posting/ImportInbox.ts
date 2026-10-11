import { app } from "electron";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TikTokSession } from "../tiktok/TikTokSession";
import type { Scheduler } from "./Scheduler";

/**
 * One post in an import manifest. Times are ISO 8601 with an offset (2026-10-10T08:00:00-04:00).
 * Instagram Reels post directly. TikTok videos go to the account's TikTok inbox as drafts (the only thing an
 * unaudited app may do); `account` is the TikTok handle ("@learnjapanese30") or open ID, and the caption is kept
 * so the "draft uploaded" notification can copy it.
 */
type ManifestPost =
  | { platform: "instagram"; kind: "video"; igUserId: string; filePath: string; caption: string; at: string; coverTimestampMs?: number; shareToFeed?: boolean }
  | { platform: "tiktok"; kind: "video"; account: string; filePath: string; caption: string; at: string }
  | {
      platform: "tiktok";
      kind: "photo";
      account: string;
      filePaths: string[];
      /** ≤ 90 chars. */
      title: string;
      description: string;
      at: string;
      coverIndex?: number;
      isAigc?: boolean;
      autoAddMusic?: boolean;
    };

interface Manifest {
  posts?: ManifestPost[];
  /** History entry IDs of scheduled posts to cancel (same as the Cancel button). */
  cancel?: string[];
}

const POLL_MS = 15_000;

/**
 * Bulk scheduling without the UI: drop a manifest at userData/import/<name>.json and each post in it
 * is scheduled through the normal Scheduler (same validation, file stashing and history entries).
 * The manifest then moves to import/done/ with a <name>.result.json listing each post's entry id or error.
 * Write manifests as .tmp and rename to .json, so a half-written file is never read.
 */
export class ImportInbox {
  private readonly dir = join(app.getPath("userData"), "import");
  private busy = false;

  constructor(
    private readonly scheduler: Scheduler,
    private readonly tiktok: TikTokSession,
  ) {}

  start(): void {
    setInterval(() => void this.scan(), POLL_MS);
    void this.scan();
  }

  private async scan(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await mkdir(join(this.dir, "done"), { recursive: true });
      const names = (await readdir(this.dir)).filter((n) => n.endsWith(".json")).sort();
      for (const name of names) await this.importFile(name);
    } catch (err) {
      console.error("[import]", err);
    } finally {
      this.busy = false;
    }
  }

  /** "@handle" or an open ID → the connected account's open ID. */
  private async tiktokOpenId(account: string): Promise<string> {
    const handle = account.replace(/^@/, "").toLowerCase();
    const found = (await this.tiktok.listAccounts()).find((a) => a.openId === account || a.username?.toLowerCase() === handle);
    if (!found) throw new Error(`TikTok account ${account} isn't connected in TikTok Poster.`);
    return found.openId;
  }

  private async importFile(name: string): Promise<void> {
    const src = join(this.dir, name);
    const results: Array<Record<string, unknown>> = [];
    let posts: ManifestPost[] = [];
    let cancel: string[] = [];
    try {
      const doc = JSON.parse(await readFile(src, "utf8")) as Manifest;
      posts = doc.posts ?? [];
      cancel = doc.cancel ?? [];
    } catch (err) {
      results.push({ error: `Couldn't read the manifest: ${message(err)}` });
    }
    for (const [i, p] of posts.entries()) {
      const row = { i, at: p.at, filePath: "filePath" in p ? p.filePath : p.filePaths[0] };
      try {
        if (p.kind === "photo") {
          // TikTok carousels also go to the inbox as drafts; the sound is added in the TikTok app.
          const entry = await this.scheduler.schedulePhotos(
            {
              openId: await this.tiktokOpenId(p.account),
              filePaths: p.filePaths,
              mode: "DRAFT",
              title: p.title,
              description: p.description,
              privacyLevel: "SELF_ONLY", // ignored for drafts
              coverIndex: p.coverIndex ?? 0,
              disableComment: false,
              autoAddMusic: p.autoAddMusic ?? false,
              isAigc: p.isAigc ?? false,
            },
            p.at,
          );
          results.push({ ...row, entryId: entry.id });
          continue;
        }
        const entry =
          p.platform === "instagram"
            ? await this.scheduler.scheduleIgVideo(
                { igUserId: p.igUserId, filePath: p.filePath, caption: p.caption, coverTimestampMs: p.coverTimestampMs ?? 0, shareToFeed: p.shareToFeed ?? true },
                p.at,
              )
            : await this.scheduler.scheduleVideo(
                {
                  openId: await this.tiktokOpenId(p.account),
                  filePath: p.filePath,
                  mode: "DRAFT",
                  title: p.caption,
                  privacyLevel: "SELF_ONLY", // ignored for drafts; you pick it when posting in the app
                  disableComment: false,
                  disableDuet: false,
                  disableStitch: false,
                  coverTimestampMs: 0,
                  isAigc: false,
                },
                p.at,
              );
        results.push({ ...row, entryId: entry.id });
      } catch (err) {
        results.push({ ...row, error: message(err) });
      }
    }
    for (const id of cancel) {
      try {
        await this.scheduler.cancel(id);
        results.push({ cancelled: id });
      } catch (err) {
        results.push({ cancelled: id, error: message(err) });
      }
    }
    const done = join(this.dir, "done");
    await writeFile(join(done, name.replace(/\.json$/, ".result.json")), JSON.stringify({ importedAt: new Date().toISOString(), results }, null, 1));
    await rename(src, join(done, name));
    console.log(`[import] ${name}: ${results.filter((r) => r.entryId).length}/${posts.length} scheduled` +
      (cancel.length ? `, ${results.filter((r) => r.cancelled && !r.error).length}/${cancel.length} cancelled` : ""));
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
