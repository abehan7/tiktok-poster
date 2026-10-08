import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { CarouselFolder, PosterApi } from "@shared/contract";
import { isAllowed, toLocalFile } from "./media";
import type { PostingService } from "./posting/PostingService";
import { createImageHost } from "./storage/ImageHost";
import type { HistoryStore } from "./store/history";
import type { SettingsStore } from "./store/settings";
import type { TikTokSession } from "./tiktok/TikTokSession";

type Handlers = Omit<PosterApi, "pathForFile" | "onProgress" | "onHistory">;

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const VIDEO_EXTS = [".mp4", ".mov", ".webm"];

interface Deps {
  window: () => BrowserWindow | null;
  settings: SettingsStore;
  session: TikTokSession;
  history: HistoryStore;
  posting: PostingService;
}

function readCarouselFolder(dir: string): CarouselFolder {
  // Slides are numbered images; "_"-prefixed files are tubelingo-carousel debug sheets.
  const images = readdirSync(dir)
    .filter((f) => IMAGE_EXTS.includes(extname(f).toLowerCase()) && !f.startsWith("_") && !f.startsWith("."))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => toLocalFile(join(dir, f)));
  const captionPath = join(dir, "caption.txt");
  return { path: dir, images, caption: existsSync(captionPath) ? readFileSync(captionPath, "utf8").trim() : "" };
}

function assertPicked(paths: string[]) {
  for (const p of paths) if (!isAllowed(p)) throw new Error(`File wasn't picked in the app: ${p}`);
}

export function registerIpc(d: Deps): void {
  const handlers: Handlers = {
    getSettings: async () => d.settings.view(),
    saveSettings: async (u) => d.settings.update(u),
    testR2: async () => createImageHost(d.settings.get()).test(),

    getAccount: () => d.session.getAccount(),
    connect: () => d.session.connect(),
    disconnect: () => d.session.disconnect(),
    getCreatorInfo: () => d.session.creatorInfo(),

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

    listHistory: async () => d.history.list(),
    refreshStatus: (id) => d.posting.refresh(id),
    removeHistory: async (id) => d.history.remove(id),
    openExternal: async (url) => {
      if (/^https:\/\//.test(url)) await shell.openExternal(url);
    },
  };

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
