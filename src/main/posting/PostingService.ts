import { nativeImage } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { extname } from "node:path";
import {
  TERMINAL_STATUSES,
  type HistoryEntry,
  type PhotoPostInput,
  type Progress,
  type VideoPostInput,
} from "@shared/contract";
import { toLocalFile } from "../media";
import { createImageHost } from "../storage/ImageHost";
import type { HistoryStore } from "../store/history";
import type { SettingsStore } from "../store/settings";
import type { FileUploadSource } from "../tiktok/TikTokGateway";
import type { TikTokSession } from "../tiktok/TikTokSession";

const MB = 1024 * 1024;
const VIDEO_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };
const POLL_EVERY_MS = 4000;
const POLL_FOR_MS = 20 * 60_000;

interface Events {
  progress(p: Progress): void;
  history(e: HistoryEntry): void;
}

/**
 * Turns a form submission into a TikTok post: validate → (convert + host
 * images) → init → upload → poll status. A post call resolves once TikTok has
 * the media; status keeps updating in the background via `events.history`.
 */
export class PostingService {
  private readonly polling = new Set<string>();

  constructor(
    private readonly session: TikTokSession,
    private readonly settings: SettingsStore,
    private readonly history: HistoryStore,
    private readonly events: Events,
  ) {}

  /** Picks up polling for posts that were still processing when the app quit. */
  resumePolling(): void {
    const dayAgo = Date.now() - 24 * 3600_000;
    for (const e of this.history.list()) {
      if (e.publishId && !TERMINAL_STATUSES.includes(e.status) && Date.parse(e.createdAt) > dayAgo) {
        this.poll(e.id);
      }
    }
  }

  async postVideo(input: VideoPostInput): Promise<HistoryEntry> {
    const type = VIDEO_TYPES[extname(input.filePath).toLowerCase()];
    if (!type) throw new Error("Video must be .mp4, .mov or .webm.");
    const { size } = await stat(input.filePath);
    if (size > 4 * 1024 * MB) throw new Error("TikTok accepts videos up to 4 GB.");
    if (input.mode === "DIRECT" && input.title.length > 2200) throw new Error("Caption is over 2200 characters.");

    const file = toLocalFile(input.filePath);
    const entry = this.start({
      kind: "video",
      mode: input.mode,
      label: input.mode === "DIRECT" && input.title ? input.title : file.name,
      thumbUrl: file.url,
    });

    return this.run(entry.id, async () => {
      const gw = this.session.gateway();
      const token = await this.session.accessToken();
      const source = chunkPlan(size);

      this.progress(entry.id, "Starting upload", 0);
      const { publishId, uploadUrl } = await gw.initVideo(
        token,
        source,
        input.mode === "DIRECT"
          ? {
              title: input.title,
              privacy_level: input.privacyLevel,
              disable_comment: input.disableComment,
              disable_duet: input.disableDuet,
              disable_stitch: input.disableStitch,
              video_cover_timestamp_ms: Math.max(0, Math.round(input.coverTimestampMs)),
              is_aigc: input.isAigc,
            }
          : null,
      );
      this.update(entry.id, { publishId });

      const fh = await open(input.filePath, "r");
      try {
        for (let i = 0; i < source.total_chunk_count; i++) {
          const first = i * source.chunk_size;
          // The last chunk absorbs the remainder.
          const length = i === source.total_chunk_count - 1 ? size - first : source.chunk_size;
          const buf = Buffer.alloc(length);
          await fh.read(buf, 0, length, first);
          this.progress(entry.id, `Uploading chunk ${i + 1}/${source.total_chunk_count}`, first / size);
          await gw.uploadChunk(uploadUrl, buf, first, size, type);
        }
      } finally {
        await fh.close();
      }
      this.progress(entry.id, "Uploaded — TikTok is processing", 1);
      return this.update(entry.id, { status: "PROCESSING_UPLOAD" });
    });
  }

  async postPhotos(input: PhotoPostInput): Promise<HistoryEntry> {
    const n = input.filePaths.length;
    if (n < 1 || n > 35) throw new Error("A photo post needs 1 to 35 images.");
    if (input.title.length > 90) throw new Error("Title is over 90 characters.");
    if (input.description.length > 4000) throw new Error("Description is over 4000 characters.");
    if (input.coverIndex < 0 || input.coverIndex >= n) throw new Error("Pick a cover image.");

    const first = toLocalFile(input.filePaths[0]);
    const entry = this.start({
      kind: "photo",
      mode: input.mode,
      label: input.title || input.description.split("\n")[0] || `${n} photos`,
      thumbUrl: first.url,
    });

    return this.run(entry.id, async () => {
      const host = createImageHost(this.settings.get());
      const folder = `${stamp()}-${randomBytes(3).toString("hex")}`;
      const urls: string[] = [];
      for (let i = 0; i < n; i++) {
        this.progress(entry.id, `Converting & uploading image ${i + 1}/${n}`, i / n);
        const jpeg = toTikTokJpeg(input.filePaths[i]);
        urls.push(await host.put(`${folder}/${i + 1}.jpg`, jpeg, "image/jpeg"));
      }

      this.progress(entry.id, "Asking TikTok to pull the images", 1);
      const direct = input.mode === "DIRECT";
      const { publishId } = await this.session.gateway().initPhoto(await this.session.accessToken(), {
        media_type: "PHOTO",
        post_mode: direct ? "DIRECT_POST" : "MEDIA_UPLOAD",
        post_info: direct
          ? {
              title: input.title,
              description: input.description,
              privacy_level: input.privacyLevel,
              disable_comment: input.disableComment,
              auto_add_music: input.autoAddMusic,
            }
          : { title: input.title, description: input.description },
        source_info: { source: "PULL_FROM_URL", photo_cover_index: input.coverIndex, photo_images: urls },
        ...(input.isAigc ? { is_aigc: true } : {}),
      });
      return this.update(entry.id, { publishId, status: "PROCESSING_DOWNLOAD" });
    });
  }

  async refresh(entryId: string): Promise<HistoryEntry> {
    const e = this.history.get(entryId);
    if (!e) throw new Error("That post is no longer in the history.");
    if (!e.publishId) return e;
    const s = await this.session.gateway().fetchStatus(await this.session.accessToken(), e.publishId);
    return this.update(entryId, { status: s.status, failReason: s.failReason, postIds: s.postIds });
  }

  private start(fields: Pick<HistoryEntry, "kind" | "mode" | "label" | "thumbUrl">): HistoryEntry {
    const now = new Date().toISOString();
    const entry: HistoryEntry = {
      id: randomUUID(),
      ...fields,
      publishId: null,
      status: "UPLOADING",
      failReason: null,
      postIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.history.add(entry);
    this.events.history(entry);
    return entry;
  }

  /** Runs the pre-publish work; a failure marks the entry FAILED and rethrows to the form. */
  private async run(entryId: string, work: () => Promise<HistoryEntry>): Promise<HistoryEntry> {
    try {
      const entry = await work();
      this.poll(entryId);
      return entry;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.update(entryId, { status: "FAILED", failReason: message });
      throw err;
    } finally {
      this.events.progress({ entryId, stage: "", fraction: null });
    }
  }

  private poll(entryId: string): void {
    if (this.polling.has(entryId)) return;
    this.polling.add(entryId);
    const until = Date.now() + POLL_FOR_MS;
    const tick = async () => {
      try {
        const e = await this.refresh(entryId);
        if (TERMINAL_STATUSES.includes(e.status) || Date.now() > until) {
          this.polling.delete(entryId);
          return;
        }
      } catch {
        // Transient (network, rate limit) — keep trying until the deadline.
        if (Date.now() > until || !this.history.get(entryId)) {
          this.polling.delete(entryId);
          return;
        }
      }
      setTimeout(tick, POLL_EVERY_MS);
    };
    setTimeout(tick, POLL_EVERY_MS);
  }

  private update(entryId: string, patch: Partial<HistoryEntry>): HistoryEntry {
    const e = this.history.update(entryId, patch);
    this.events.history(e);
    return e;
  }

  private progress(entryId: string, stage: string, fraction: number | null) {
    this.events.progress({ entryId, stage, fraction });
  }
}

/**
 * TikTok chunk rules: chunks 5–64 MB, files ≤ 64 MB go in one piece,
 * total_chunk_count = floor(size / chunk_size) and the last chunk takes the rest.
 */
export function chunkPlan(size: number): FileUploadSource {
  if (size <= 64 * MB) {
    return { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 };
  }
  const chunk = 32 * MB;
  return { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: Math.floor(size / chunk) };
}

/** TikTok photo posts take JPEG/WebP up to 1080p and 20 MB. */
export function toTikTokJpeg(path: string): Buffer {
  let img = nativeImage.createFromPath(path);
  if (img.isEmpty()) throw new Error(`Couldn't read image ${path}`);
  const { width, height } = img.getSize();
  const scale = Math.min(1, 1080 / Math.min(width, height), 1920 / Math.max(width, height));
  if (scale < 1) {
    img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: "best" });
  }
  for (const quality of [92, 85, 75]) {
    const jpeg = img.toJPEG(quality);
    if (jpeg.length <= 20 * MB) return jpeg;
  }
  throw new Error(`${path} is still over 20 MB as a JPEG.`);
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}
