/**
 * The IPC contract between the main process and the renderer. The preload
 * script exposes `PosterApi` as `window.poster`; every method maps 1:1 to an
 * `ipcMain.handle` channel of the same name.
 */

export type Appearance = "system" | "light" | "dark";

export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

/** DIRECT = straight to the profile (video.publish); DRAFT = TikTok inbox (video.upload). */
export type PostMode = "DIRECT" | "DRAFT";

export type PostStatus =
  | "SCHEDULED"
  | "CANCELLED"
  | "UPLOADING"
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED";

export const TERMINAL_STATUSES: PostStatus[] = ["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED", "CANCELLED"];

/** What the renderer sees of settings. Secrets are never sent back, only whether they are set. */
export interface SettingsView {
  clientKey: string;
  hasClientSecret: boolean;
  directPostEnabled: boolean;
  oauthPort: number;
  redirectUri: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  hasR2SecretAccessKey: boolean;
  r2Bucket: string;
  r2PublicBaseUrl: string;
  r2KeyPrefix: string;
  carouselFolder: string;
  appearance: Appearance;
  /** True when no TikTok client key is set: everything runs against a fake TikTok. */
  mockMode: boolean;
}

/** Fields the settings form can change. Omitted / empty secret fields keep the stored value. */
export interface SettingsUpdate {
  clientKey?: string;
  clientSecret?: string;
  directPostEnabled?: boolean;
  oauthPort?: number;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2Bucket?: string;
  r2PublicBaseUrl?: string;
  r2KeyPrefix?: string;
  carouselFolder?: string;
  appearance?: Appearance;
}

export interface Account {
  openId: string;
  displayName: string;
  /** TikTok @handle (from creator_info; null if Direct Post isn't granted). */
  username: string | null;
  avatarUrl: string | null;
  /** Free-text reminder, e.g. which email/Google login this account uses. TikTok never exposes emails. */
  note: string;
  scopes: string[];
  connectedAt: string;
}

export interface CreatorInfo {
  username: string;
  nickname: string;
  avatarUrl: string | null;
  privacyLevelOptions: PrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

/** A local file the user picked or dropped. `url` is a media:// URL the renderer can preview. */
export interface LocalFile {
  path: string;
  name: string;
  size: number;
  url: string;
}

export interface VideoPostInput {
  /** Account to post as. */
  openId: string;
  filePath: string;
  mode: PostMode;
  /** Caption (≤ 2200 chars). Used for DIRECT only — drafts are captioned in the TikTok app. */
  title: string;
  privacyLevel: PrivacyLevel;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  coverTimestampMs: number;
  isAigc: boolean;
}

export interface PhotoPostInput {
  /** Account to post as. */
  openId: string;
  filePaths: string[];
  mode: PostMode;
  /** ≤ 90 chars. */
  title: string;
  /** ≤ 4000 chars. */
  description: string;
  privacyLevel: PrivacyLevel;
  coverIndex: number;
  disableComment: boolean;
  autoAddMusic: boolean;
  isAigc: boolean;
}

/** What was (or will be) posted, kept so a post can be opened later. */
export interface PostContent {
  title: string;
  /** Caption / description. */
  description: string;
  /** Slide images: R2 https URLs once uploaded, media:// URLs before. */
  images: string[];
  coverIndex: number;
  /** media:// URL of the video file. */
  video: string | null;
  privacyLevel: PrivacyLevel | null;
  autoAddMusic: boolean;
}

export interface HistoryEntry {
  id: string;
  kind: "video" | "photo";
  mode: PostMode;
  label: string;
  /** Account it was posted as (null for posts made before multi-account support). */
  openId: string | null;
  accountName: string | null;
  /** media:// URL of the first image or the video, for the thumbnail. */
  thumbUrl: string | null;
  publishId: string | null;
  status: PostStatus;
  /** ISO time a scheduled post goes out (null for immediate posts). */
  scheduledAt: string | null;
  /** True while a schedule job (and its file copies) still exists, so "Post now" works. */
  hasJob?: boolean;
  /** When the upload actually started (for "went out late" on scheduled posts). */
  sentAt?: string | null;
  /** Set by the user when they've finished/published a draft in TikTok (the API can't tell us). */
  finishedAt?: string | null;
  /** Missing on entries made before content was stored. */
  content?: PostContent;
  failReason: string | null;
  postIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** A tubelingo-carousel style render folder: N slide images + caption.txt. */
export interface CarouselFolder {
  path: string;
  images: LocalFile[];
  caption: string;
}

export interface Progress {
  entryId: string;
  stage: string;
  /** 0–1, or null when indeterminate. */
  fraction: number | null;
}

/** A native context-menu item; `id` comes back from `contextMenu` when chosen. */
export type MenuItem = { id: string; label: string; enabled?: boolean } | { separator: true };

export type View = "carousel" | "video" | "calendar" | "history" | "settings";

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface PosterApi {
  getSettings(): Promise<SettingsView>;
  saveSettings(update: SettingsUpdate): Promise<SettingsView>;
  testR2(): Promise<TestResult>;
  chooseFolder(defaultPath?: string): Promise<string | null>;
  /** System accent colour as #rrggbb. */
  getAccentColor(): Promise<string>;
  contextMenu(items: MenuItem[]): Promise<string | null>;

  listAccounts(): Promise<Account[]>;
  /** Browser login; adds whichever TikTok account signs in (or refreshes it if already connected). */
  connect(): Promise<Account>;
  /** Abandons a login that is still waiting for the browser. */
  cancelConnect(): Promise<void>;
  disconnect(openId: string): Promise<void>;
  setAccountNote(openId: string, note: string): Promise<Account[]>;
  getCreatorInfo(openId: string): Promise<CreatorInfo>;

  pickVideo(): Promise<LocalFile | null>;
  pickImages(): Promise<LocalFile[]>;
  pickCarouselFolder(): Promise<CarouselFolder | null>;
  /** Registers files dropped onto the window (paths come from preload's webUtils). */
  registerFiles(paths: string[]): Promise<LocalFile[]>;

  postVideo(input: VideoPostInput): Promise<HistoryEntry>;
  postPhotos(input: PhotoPostInput): Promise<HistoryEntry>;
  /** Validates now, copies the files, and posts at `at` (ISO) while the app is running. */
  scheduleVideo(input: VideoPostInput, at: string): Promise<HistoryEntry>;
  schedulePhotos(input: PhotoPostInput, at: string): Promise<HistoryEntry>;
  reschedule(entryId: string, at: string): Promise<HistoryEntry>;
  cancelScheduled(entryId: string): Promise<HistoryEntry>;
  postScheduledNow(entryId: string): Promise<void>;

  listHistory(): Promise<HistoryEntry[]>;
  refreshStatus(entryId: string): Promise<HistoryEntry>;
  removeHistory(entryId: string): Promise<void>;
  /** Marks a delivered draft as published in TikTok (or undoes it). */
  setFinished(entryId: string, finished: boolean): Promise<HistoryEntry>;
  openExternal(url: string): Promise<void>;

  /** Path of a File from a drop event. */
  pathForFile(file: File): string;
  onProgress(listener: (progress: Progress) => void): () => void;
  onHistory(listener: (entry: HistoryEntry) => void): () => void;
  onAccentColor(listener: (hex: string) => void): () => void;
  /** App-menu navigation (e.g. Settings… ⌘,). */
  onNavigate(listener: (view: View) => void): () => void;
}
