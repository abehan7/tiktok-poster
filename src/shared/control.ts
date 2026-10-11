/**
 * The control socket the `tiktok-poster` CLI talks to: newline-delimited JSON over a Unix socket in
 * userData, readable only by the user. It exposes the same handlers as the renderer's IPC (minus the
 * native file dialogs) plus a few extras, and streams the progress/history events to subscribers.
 */
import type { CarouselFolder, PosterApi, View } from "./contract";

export const CONTROL_SOCKET = "control.sock";

/**
 * userData/control.sock, unless that's past the 104-byte limit macOS puts on socket paths: then a short
 * stand-in in /tmp named after the folder (still owner-only), so the app and the CLI agree on it.
 */
export function controlSocketPath(userData: string): string {
  const path = `${userData.replace(/\/+$/, "")}/${CONTROL_SOCKET}`;
  if (new TextEncoder().encode(path).length < 100) return path;
  let hash = 5381;
  for (const ch of userData) hash = ((hash * 33) ^ ch.codePointAt(0)!) >>> 0;
  return `/tmp/tiktok-poster-${hash.toString(36)}.sock`;
}

/** Points the app (and the CLI) at another data folder, e.g. to try things in mock mode next to the real app. */
export const USER_DATA_ENV = "TIKTOK_POSTER_USER_DATA";

/** Handlers that open native dialogs; the CLI names files by path instead. */
export const GUI_ONLY = ["chooseFolder", "contextMenu", "pickVideo", "pickImages", "pickCarouselFolder"] as const;

export interface ControlPing {
  pid: number;
  version: string;
  userData: string;
  mockMode: boolean;
  /** Scheduled posts still waiting to go out. */
  pending: number;
}

export interface ControlExtras {
  ping(): Promise<ControlPing>;
  /** Brings the window up, optionally on a view. */
  show(view?: View): Promise<void>;
  /** A render folder: numbered slide images + caption.txt (same rules as "Load render folder…"). */
  readCarouselFolder(dir: string): Promise<CarouselFolder>;
}

export type ControlApi = Omit<
  PosterApi,
  "pathForFile" | "onProgress" | "onHistory" | "onAccentColor" | "onNavigate" | (typeof GUI_ONLY)[number]
> &
  ControlExtras;

export interface ControlRequest {
  id: number;
  /** A ControlApi method, or "subscribe" to start receiving events on this connection. */
  method: string;
  params?: unknown[];
}

export type ControlReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export interface ControlEvent {
  event: "progress" | "history";
  data: unknown;
}
