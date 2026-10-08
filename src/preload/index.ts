import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { HistoryEntry, PosterApi, Progress } from "@shared/contract";

type Result = { ok: true; value: unknown } | { ok: false; error: string };

const invoke =
  (channel: string) =>
  async (...args: unknown[]) => {
    const r = (await ipcRenderer.invoke(channel, ...args)) as Result;
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

const channels = [
  "getSettings", "saveSettings", "testR2",
  "getAccount", "connect", "disconnect", "getCreatorInfo",
  "pickVideo", "pickImages", "pickCarouselFolder", "registerFiles",
  "postVideo", "postPhotos",
  "listHistory", "refreshStatus", "removeHistory", "openExternal",
] as const;

const api = {
  ...Object.fromEntries(channels.map((c) => [c, invoke(c)])),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onProgress: (listener: (p: Progress) => void) => {
    const h = (_: unknown, p: Progress) => listener(p);
    ipcRenderer.on("progress", h);
    return () => void ipcRenderer.removeListener("progress", h);
  },
  onHistory: (listener: (e: HistoryEntry) => void) => {
    const h = (_: unknown, e: HistoryEntry) => listener(e);
    ipcRenderer.on("history", h);
    return () => void ipcRenderer.removeListener("history", h);
  },
} as PosterApi;

contextBridge.exposeInMainWorld("poster", api);
