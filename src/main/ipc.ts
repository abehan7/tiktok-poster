import { BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, systemPreferences } from "electron";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { CarouselFolder, PosterApi } from "@shared/contract";
import { isAllowed, toLocalFile } from "./media";
import type { InstagramSession } from "./instagram/InstagramSession";
import type { InstagramPostingService } from "./posting/InstagramPostingService";
import type { PostingService } from "./posting/PostingService";
import type { Scheduler } from "./posting/Scheduler";
import { createImageHost } from "./storage/ImageHost";
import { cancelAuthorization } from "./tiktok/oauth";
import type { HistoryStore } from "./store/history";
import type { SettingsStore } from "./store/settings";
import type { TikTokSession } from "./tiktok/TikTokSession";

export type Handlers = Omit<PosterApi, "pathForFile" | "onProgress" | "onHistory" | "onAccentColor" | "onNavigate">;

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const VIDEO_EXTS = [".mp4", ".mov", ".webm"];

interface Deps {
  window: () => BrowserWindow | null;
  settings: SettingsStore;
  session: TikTokSession;
  history: HistoryStore;
  posting: PostingService;
  instagram: InstagramSession;
  igPosting: InstagramPostingService;
  scheduler: Scheduler;
}

export function readCarouselFolder(dir: string): CarouselFolder {
  // Slides are numbered images; "_"-prefixed files (e.g. debug sheets) are skipped.
  const images = readdirSync(dir)
    .filter((f) => IMAGE_EXTS.includes(extname(f).toLowerCase()) && !f.startsWith("_") && !f.startsWith("."))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => toLocalFile(join(dir, f)));
  const captionPath = join(dir, "caption.txt");
  return { path: dir, images, caption: existsSync(captionPath) ? readFileSync(captionPath, "utf8").trim() : "" };
}

/** System accent colour; falls back to macOS blue. */
export function accentHex(): string {
  try {
    return `#${systemPreferences.getAccentColor().slice(0, 6)}`;
  } catch {
    return "#007aff";
  }
}

function assertPicked(paths: string[]) {
  for (const p of paths) if (!isAllowed(p)) throw new Error(`File wasn't picked in the app: ${p}`);
}

export function createHandlers(d: Deps): Handlers {
  return {
    getSettings: async () => d.settings.view(),
    saveSettings: async (u) => {
      const view = d.settings.update(u);
      nativeTheme.themeSource = view.appearance;
      return view;
    },
    testR2: async () => createImageHost(d.settings.get()).test(),
    chooseFolder: async (defaultPath) => {
      const r = await dialog.showOpenDialog(d.window()!, {
        properties: ["openDirectory", "createDirectory"],
        defaultPath: defaultPath && existsSync(defaultPath) ? defaultPath : undefined,
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    getAccentColor: async () => accentHex(),
    contextMenu: (items) =>
      new Promise((resolve) => {
        let chosen: string | null = null;
        const menu = Menu.buildFromTemplate(
          items.map((item) =>
            "separator" in item
              ? { type: "separator" as const }
              : { label: item.label, enabled: item.enabled ?? true, click: () => (chosen = item.id) },
          ),
        );
        // `callback` fires after the click handler, so `chosen` is set by then.
        menu.popup({ window: d.window() ?? undefined, callback: () => resolve(chosen) });
      }),

    listAccounts: () => d.session.listAccounts(),
    connect: () => d.session.connect(),
    cancelConnect: () => cancelAuthorization(),
    disconnect: (openId) => d.session.disconnect(openId),
    setAccountNote: async (openId, note) => {
      d.session.setNote(openId, note);
      return d.session.listAccounts();
    },
    getCreatorInfo: (openId) => d.session.creatorInfo(openId),

    listIgAccounts: () => d.instagram.listAccounts(),
    connectInstagram: () => d.instagram.connect(),
    addInstagramToken: (token) => d.instagram.addToken(token),
    disconnectInstagram: async (id) => d.instagram.disconnect(id),
    setIgAccountNote: async (id, note) => {
      d.instagram.setNote(id, note);
      return d.instagram.listAccounts();
    },

    pickVideo: async () => {
      const r = await dialog.showOpenDialog(d.window()!, {
        properties: ["openFile"],
        filters: [{ name: "Video", extensions: VIDEO_EXTS.map((e) => e.slice(1)) }],
      });
      return r.canceled || !r.filePaths[0] ? null : toLocalFile(r.filePaths[0]);
    },
    pickImages: async () => {
      const r = await dialog.showOpenDialog(d.window()!, {
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: IMAGE_EXTS.map((e) => e.slice(1)) }],
      });
      return r.canceled ? [] : r.filePaths.map(toLocalFile);
    },
    pickCarouselFolder: async () => {
      const base = d.settings.get().carouselFolder;
      const r = await dialog.showOpenDialog(d.window()!, {
        properties: ["openDirectory"],
        defaultPath: existsSync(base) ? base : undefined,
      });
      return r.canceled || !r.filePaths[0] ? null : readCarouselFolder(r.filePaths[0]);
    },
    registerFiles: async (paths) =>
      paths
        .filter((p) => existsSync(p) && statSync(p).isFile())
        .filter((p) => [...IMAGE_EXTS, ...VIDEO_EXTS].includes(extname(p).toLowerCase()))
        .map(toLocalFile),

    postVideo: async (input) => {
      assertPicked([input.filePath]);
      return d.posting.postVideo(input);
    },
    postPhotos: async (input) => {
      assertPicked(input.filePaths);
      return d.posting.postPhotos(input);
    },

    scheduleVideo: async (input, at) => {
      assertPicked([input.filePath]);
      return d.scheduler.scheduleVideo(input, at);
    },
    schedulePhotos: async (input, at) => {
      assertPicked(input.filePaths);
      return d.scheduler.schedulePhotos(input, at);
    },
    postIgPhotos: async (input) => {
      assertPicked(input.filePaths);
      return d.igPosting.postPhotos(input);
    },
    postIgVideo: async (input) => {
      assertPicked([input.filePath]);
      return d.igPosting.postVideo(input);
    },
    scheduleIgPhotos: async (input, at) => {
      assertPicked(input.filePaths);
      return d.scheduler.scheduleIgPhotos(input, at);
    },
    scheduleIgVideo: async (input, at) => {
      assertPicked([input.filePath]);
      return d.scheduler.scheduleIgVideo(input, at);
    },
    reschedule: async (id, at) => d.scheduler.reschedule(id, at),
    cancelScheduled: (id) => d.scheduler.cancel(id),
    postScheduledNow: (id) => d.scheduler.postNow(id),

    listHistory: async () => {
      // media:// only serves files registered this launch; re-allow thumbnails that still exist.
      const entries = d.history.list();
      for (const e of entries) {
        const urls = [e.thumbUrl, e.content?.video, ...(e.content?.images ?? [])];
        for (const u of urls) {
          if (!u?.startsWith("media:")) continue;
          const p = new URL(u).searchParams.get("p");
          if (p && existsSync(p)) toLocalFile(p);
        }
      }
      return d.scheduler.decorate(entries);
    },
    refreshStatus: (id) => (d.history.get(id)?.platform === "instagram" ? d.igPosting.refresh(id) : d.posting.refresh(id)),
    removeHistory: async (id) => d.history.remove(id),
    clearCancelled: async (ids) => {
      // Only ever cancelled ones, whatever the renderer sends (their stashed files went at cancel time).
      const wanted = new Set(ids);
      const gone = d.history.list().filter((e) => wanted.has(e.id) && e.status === "CANCELLED").map((e) => e.id);
      d.history.removeMany(gone);
      return gone.length;
    },
    setFinished: async (id, finished) => {
      const e = d.history.get(id);
      if (!e) throw new Error("That post is no longer in the history.");
      if (finished && e.status !== "SEND_TO_USER_INBOX") throw new Error("Only drafts delivered to TikTok can be marked posted.");
      return d.scheduler.decorate([d.posting.update(id, { finishedAt: finished ? new Date().toISOString() : null })])[0];
    },
    openExternal: async (url) => {
      if (/^https:\/\//.test(url)) await shell.openExternal(url);
    },
  };
}

export function registerIpc(handlers: Handlers): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
      try {
        return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) };
      } catch (err) {
        // Return errors as values: Electron prefixes thrown IPC errors with noise.
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }
}
