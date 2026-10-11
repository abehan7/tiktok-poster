import { nativeImage } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { HistoryEntry, IgPhotoPostInput, IgVideoPostInput, PostContent, Progress } from "@shared/contract";
import { InstagramError } from "../instagram/InstagramGateway";
import type { InstagramSession } from "../instagram/InstagramSession";
import { toLocalFile } from "../media";
import { createImageHost } from "../storage/ImageHost";
import type { HistoryStore } from "../store/history";
import type { SettingsStore } from "../store/settings";

const MB = 1024 * 1024;
const MAX_ITEMS = 10;
const REEL_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime" };
/** Instagram feed images must be between 4:5 (portrait) and 1.91:1 (landscape). */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;
const MAX_WIDTH = 1080;
/** Reels can take a few minutes to process; images a few seconds. */
const WAIT_FOR_MS = 15 * 60_000;

interface Events {
  progress(p: Progress): void;
  history(e: HistoryEntry): void;
}

/**
 * Instagram posts: host the media on R2 → create a media container → wait for
 * Instagram to process it → publish. The post call resolves once the container
 * exists; processing and publishing continue in the background.
 * Instagram's API has no drafts, so everything goes straight to the profile.
 */
export class InstagramPostingService {
  /** Entries with a status check / publish in flight, so a manual refresh can't publish twice. */
  private readonly busy = new Set<string>();
  private readonly waiting = new Set<string>();

  constructor(
    private readonly session: InstagramSession,
    private readonly settings: SettingsStore,
    private readonly history: HistoryStore,
    private readonly events: Events,
  ) {}

  /** Picks up posts that were still processing when the app quit (containers last 24h). */
  resumePolling(): void {
    const dayAgo = Date.now() - 24 * 3600_000;
    for (const e of this.history.list()) {
      if (e.platform === "instagram" && e.publishId && e.status === "PROCESSING_UPLOAD" && Date.parse(e.updatedAt) > dayAgo) {
        this.wait(e.id);
      }
    }
  }

  validatePhotos(input: IgPhotoPostInput): void {
    const n = input.filePaths.length;
    if (n < 1 || n > MAX_ITEMS) throw new Error(`An Instagram post takes 1 to ${MAX_ITEMS} images.`);
    validateCaption(input.caption);
    this.requireAccount(input.igUserId);
  }

  async validateVideo(input: IgVideoPostInput): Promise<{ type: string; size: number }> {
    const type = REEL_TYPES[extname(input.filePath).toLowerCase()];
    if (!type) throw new Error("Instagram Reels must be .mp4 or .mov.");
    const { size } = await stat(input.filePath);
    if (size > 300 * MB) throw new Error("Instagram accepts Reels up to 300 MB.");
    validateCaption(input.caption);
    this.requireAccount(input.igUserId);
    return { type, size };
  }

  async postPhotos(input: IgPhotoPostInput, entryId?: string): Promise<HistoryEntry> {
    this.validatePhotos(input);
    const n = input.filePaths.length;
    const entry = this.start(input.igUserId, entryId, {
      kind: "photo",
      label: photoLabel(input),
      thumbUrl: toLocalFile(input.filePaths[0]).url,
    });
    this.update(entry.id, { content: igPhotoContent(input, input.filePaths.map((p) => toLocalFile(p).url)) });

    return this.run(entry.id, async () => {
      const host = createImageHost(this.settings.get());
      const folder = `ig-${stamp()}-${randomBytes(3).toString("hex")}`;
      // Instagram crops every slide to the first one's shape, so pad them all to that shape.
      const ratio = clampRatio(sizeOf(input.filePaths[0]));
      const urls: string[] = [];
      for (let i = 0; i < n; i++) {
        this.progress(entry.id, `Converting & uploading image ${i + 1}/${n}`, i / n);
        urls.push(await host.put(`${folder}/${i + 1}.jpg`, toInstagramJpeg(input.filePaths[i], ratio), "image/jpeg"));
      }
      this.update(entry.id, { content: igPhotoContent(input, urls) });

      const gw = this.session.gateway();
      const token = await this.session.accessToken(input.igUserId);
      let container: string;
      if (n === 1) {
        this.progress(entry.id, "Sending to Instagram", 1);
        container = await gw.createContainer(token, input.igUserId, { kind: "image", imageUrl: urls[0], caption: input.caption });
      } else {
        const children: string[] = [];
        for (let i = 0; i < n; i++) {
          this.progress(entry.id, `Sending slide ${i + 1}/${n} to Instagram`, i / n);
          children.push(await gw.createContainer(token, input.igUserId, { kind: "image", imageUrl: urls[i], carouselItem: true }));
        }
        this.progress(entry.id, "Creating the carousel", 1);
        container = await this.withRetry(() =>
          gw.createContainer(token, input.igUserId, { kind: "carousel", children, caption: input.caption }),
        );
      }
      return this.update(entry.id, { publishId: container, status: "PROCESSING_UPLOAD" });
    });
  }

  async postVideo(input: IgVideoPostInput, entryId?: string): Promise<HistoryEntry> {
    const { type, size } = await this.validateVideo(input);
    const file = toLocalFile(input.filePath);
    const entry = this.start(input.igUserId, entryId, { kind: "video", label: input.caption.split("\n")[0] || file.name, thumbUrl: file.url });
    this.update(entry.id, { content: igVideoContent(input, file.url) });

    return this.run(entry.id, async () => {
      // Reels are pulled from a public URL (resumable upload needs Facebook Login), so host it on R2 first.
      this.progress(entry.id, `Uploading video to R2 (${Math.round(size / MB)} MB)`, null);
      const ext = extname(input.filePath).toLowerCase();
      const url = await createImageHost(this.settings.get()).put(
        `ig-${stamp()}-${randomBytes(3).toString("hex")}/reel${ext}`,
        await readFile(input.filePath),
        type,
      );
      this.progress(entry.id, "Sending the Reel to Instagram", 1);
      const container = await this.session.gateway().createContainer(await this.session.accessToken(input.igUserId), input.igUserId, {
        kind: "reel",
        videoUrl: url,
        caption: input.caption,
        thumbOffsetMs: input.coverTimestampMs,
        shareToFeed: input.shareToFeed,
      });
      return this.update(entry.id, { publishId: container, status: "PROCESSING_UPLOAD" });
    });
  }

  /** One status check (publishing when Instagram is ready). Used by Refresh and by the background wait. */
  async refresh(entryId: string): Promise<HistoryEntry> {
    const e = this.history.get(entryId);
    if (!e) throw new Error("That post is no longer in the history.");
    if (!e.publishId || !e.openId || e.status !== "PROCESSING_UPLOAD" || this.busy.has(entryId)) return e;
    this.busy.add(entryId);
    try {
      const gw = this.session.gateway();
      const token = await this.session.accessToken(e.openId);
      const s = await gw.containerStatus(token, e.publishId);
      switch (s.status) {
        case "IN_PROGRESS":
          return e;
        case "ERROR":
          return this.update(entryId, { status: "FAILED", failReason: s.detail });
        case "EXPIRED":
          return this.update(entryId, {
            status: "FAILED",
            failReason: "Instagram dropped the upload because it wasn't published within 24 hours. Post it again.",
          });
        case "PUBLISHED":
          return this.update(entryId, { status: "PUBLISH_COMPLETE", failReason: null });
        case "FINISHED": {
          const mediaId = await gw.publish(token, e.openId, e.publishId);
          const permalink = await gw.permalink(token, mediaId).catch(() => null);
          return this.update(entryId, { status: "PUBLISH_COMPLETE", failReason: null, postIds: [mediaId], permalink });
        }
      }
    } catch (err) {
      // An API refusal at publish time (limit reached, bad media) is final; network trouble isn't.
      if (err instanceof InstagramError && err.code !== null) {
        this.session.noteLogin(e.openId, err);
        return this.update(entryId, { status: "FAILED", failReason: err.message });
      }
      throw err;
    } finally {
      this.busy.delete(entryId);
    }
  }

  private wait(entryId: string): void {
    if (this.waiting.has(entryId)) return;
    this.waiting.add(entryId);
    const until = Date.now() + WAIT_FOR_MS;
    let attempt = 0;
    const tick = async () => {
      try {
        const e = await this.refresh(entryId);
        if (e.status !== "PROCESSING_UPLOAD") return void this.waiting.delete(entryId);
      } catch {
        // Transient (network, rate limit) — keep trying until the deadline.
      }
      if (Date.now() > until || !this.history.get(entryId)) return void this.waiting.delete(entryId);
      // Quick at first (images are ready in seconds), then back off to spare the rate limit.
      setTimeout(tick, Math.min(30_000, 2000 * 1.6 ** attempt++));
    };
    setTimeout(tick, 2000);
  }

  private requireAccount(igUserId: string) {
    const account = this.session.stored(igUserId);
    if (!account) throw new Error("That Instagram account isn't connected. Connect it again.");
    return account;
  }

  /** Adds a history entry (status UPLOADING, or SCHEDULED when `scheduledAt` is given). */
  createEntry(
    igUserId: string,
    fields: Pick<HistoryEntry, "kind" | "label" | "thumbUrl">,
    scheduledAt: string | null = null,
  ): HistoryEntry {
    const account = this.requireAccount(igUserId);
    const now = new Date().toISOString();
    const entry: HistoryEntry = {
      id: randomUUID(),
      platform: "instagram",
      mode: "DIRECT",
      ...fields,
      openId: igUserId,
      accountName: `@${account.username}`,
      publishId: null,
      status: scheduledAt ? "SCHEDULED" : "UPLOADING",
      scheduledAt,
      sentAt: scheduledAt ? null : now,
      finishedAt: null,
      failReason: null,
      postIds: [],
      permalink: null,
      createdAt: now,
      updatedAt: now,
    };
    this.history.add(entry);
    this.events.history(entry);
    return entry;
  }

  private start(igUserId: string, entryId: string | undefined, fields: Pick<HistoryEntry, "kind" | "label" | "thumbUrl">) {
    if (!entryId) return this.createEntry(igUserId, fields);
    return this.update(entryId, { status: "UPLOADING", failReason: null, sentAt: new Date().toISOString() });
  }

  /** Runs the pre-publish work; a failure marks the entry FAILED and rethrows to the form. */
  private async run(entryId: string, work: () => Promise<HistoryEntry>): Promise<HistoryEntry> {
    const account = this.history.get(entryId)?.openId;
    try {
      const entry = await work();
      if (account) this.session.noteLogin(account);
      this.wait(entryId);
      return entry;
    } catch (err) {
      if (account) this.session.noteLogin(account, err);
      const message = err instanceof Error ? err.message : String(err);
      this.update(entryId, { status: "FAILED", failReason: message });
      throw new Error(message);
    } finally {
      this.events.progress({ entryId, stage: "", fraction: null });
    }
  }

  /** The carousel container can be refused for a moment while its slides are still being fetched. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i >= 4 || !(err instanceof InstagramError) || err.code === 190 || err.code === 10) throw err;
        await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
      }
    }
  }

  update(entryId: string, patch: Partial<HistoryEntry>): HistoryEntry {
    const e = this.history.update(entryId, patch);
    this.events.history(e);
    return e;
  }

  private progress(entryId: string, stage: string, fraction: number | null) {
    this.events.progress({ entryId, stage, fraction });
  }
}

function validateCaption(caption: string) {
  if (caption.length > 2200) throw new Error("The Instagram caption is over 2200 characters.");
  if ((caption.match(/#[^\s#]+/g) ?? []).length > 30) throw new Error("Instagram allows at most 30 hashtags.");
  if ((caption.match(/@[\w.]+/g) ?? []).length > 20) throw new Error("Instagram allows at most 20 @mentions.");
}

export function photoLabel(input: IgPhotoPostInput): string {
  return input.caption.split("\n")[0]?.slice(0, 80) || `${input.filePaths.length} photos`;
}

function sizeOf(path: string): { width: number; height: number } {
  const img = nativeImage.createFromPath(path);
  if (img.isEmpty()) throw new Error(`Couldn't read image ${path}`);
  return img.getSize();
}

function clampRatio({ width, height }: { width: number; height: number }): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));
}

/**
 * JPEG at most 1080 px wide, padded (never cropped, slides carry text) to
 * `ratio` with the image's average edge colour. A 1080×1440 slide becomes
 * 1080×1350 with thin side bars.
 */
export function toInstagramJpeg(path: string, ratio: number): Buffer {
  let img = nativeImage.createFromPath(path);
  if (img.isEmpty()) throw new Error(`Couldn't read image ${path}`);
  const { width, height } = img.getSize();
  // Canvas in source pixels: widen a too-tall image, heighten a too-wide one.
  const canvasW = width / height < ratio ? height * ratio : width;
  const canvasH = width / height < ratio ? height : width / ratio;
  const scale = Math.min(1, MAX_WIDTH / canvasW);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  if (scale < 1) img = img.resize({ width: w, height: h, quality: "best" });
  const W = Math.round(canvasW * scale);
  const H = Math.round(canvasH * scale);
  if (Math.abs(W - w) <= 1 && Math.abs(H - h) <= 1) return img.toJPEG(90);

  const src = img.toBitmap();
  // Bitmap is 4 bytes per pixel in the platform's order (BGRA on macOS); it's copied straight back, so order doesn't matter.
  if (src.length !== w * h * 4) return img.toJPEG(90);
  const fill = edgeColour(src, w, h, W > w);
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < out.length; i += 4) fill.copy(out, i);
  const ox = Math.floor((W - w) / 2);
  const oy = Math.floor((H - h) / 2);
  for (let y = 0; y < h; y++) src.copy(out, ((y + oy) * W + ox) * 4, y * w * 4, (y + 1) * w * 4);
  return nativeImage.createFromBitmap(out, { width: W, height: H }).toJPEG(90);
}

/** Average of the left+right columns (side padding) or top+bottom rows, fully opaque. */
function edgeColour(px: Buffer, w: number, h: number, sides: boolean): Buffer {
  const sum = [0, 0, 0];
  let n = 0;
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    sum[0] += px[i];
    sum[1] += px[i + 1];
    sum[2] += px[i + 2];
    n++;
  };
  if (sides) {
    for (let y = 0; y < h; y++) {
      add(0, y);
      add(w - 1, y);
    }
  } else {
    for (let x = 0; x < w; x++) {
      add(x, 0);
      add(x, h - 1);
    }
  }
  // Alpha sits in the 4th byte for both BGRA and RGBA.
  return Buffer.from([Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n), 255]);
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export function igPhotoContent(input: IgPhotoPostInput, images: string[]): PostContent {
  return { title: "", description: input.caption, images, coverIndex: 0, video: null, privacyLevel: null, autoAddMusic: false };
}

export function igVideoContent(input: IgVideoPostInput, videoUrl: string | null): PostContent {
  return { title: "", description: input.caption, images: [], coverIndex: 0, video: videoUrl, privacyLevel: null, autoAddMusic: false };
}
