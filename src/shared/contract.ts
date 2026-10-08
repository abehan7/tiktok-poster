/**
 * The IPC contract between the main process and the renderer. The preload
 * script exposes `PosterApi` as `window.poster`; every method maps 1:1 to an
 * `ipcMain.handle` channel of the same name.
 */

export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

/** DIRECT = straight to the profile (video.publish); DRAFT = TikTok inbox (video.upload). */
export type PostMode = "DIRECT" | "DRAFT";

export type PostStatus =
  | "UPLOADING"
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED";

export const TERMINAL_STATUSES: PostStatus[] = ["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"];

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
}

export interface Account {
  openId: string;
  displayName: string;
  avatarUrl: string | null;
  scopes: string[];
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

export interface HistoryEntry {
  id: string;
  kind: "video" | "photo";
  mode: PostMode;
  label: string;
  /** media:// URL of the first image or the video, for the thumbnail. */
  thumbUrl: string | null;
  publishId: string | null;
  status: PostStatus;
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

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface PosterApi {
  getSettings(): Promise<SettingsView>;
  saveSettings(update: SettingsUpdate): Promise<SettingsView>;
  testR2(): Promise<TestResult>;

  getAccount(): Promise<Account | null>;
  connect(): Promise<Account>;
  disconnect(): Promise<void>;
  getCreatorInfo(): Promise<CreatorInfo>;

  pickVideo(): Promise<LocalFile | null>;
  pickImages(): Promise<LocalFile[]>;
  pickCarouselFolder(): Promise<CarouselFolder | null>;
  /** Registers files dropped onto the window (paths come from preload's webUtils). */
  registerFiles(paths: string[]): Promise<LocalFile[]>;

  postVideo(input: VideoPostInput): Promise<HistoryEntry>;
  postPhotos(input: PhotoPostInput): Promise<HistoryEntry>;

  listHistory(): Promise<HistoryEntry[]>;
  refreshStatus(entryId: string): Promise<HistoryEntry>;
  removeHistory(entryId: string): Promise<void>;
  openExternal(url: string): Promise<void>;

  /** Path of a File from a drop event. */
  pathForFile(file: File): string;
  onProgress(listener: (progress: Progress) => void): () => void;
  onHistory(listener: (entry: HistoryEntry) => void): () => void;
}
