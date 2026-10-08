import type { CreatorInfo, PostStatus, PrivacyLevel } from "@shared/contract";

export interface TokenGrant {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  openId: string;
  scopes: string[];
}

export interface UserInfo {
  openId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface VideoPostInfo {
  title: string;
  privacy_level: PrivacyLevel;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  video_cover_timestamp_ms: number;
  is_aigc: boolean;
}

export interface FileUploadSource {
  source: "FILE_UPLOAD";
  video_size: number;
  chunk_size: number;
  total_chunk_count: number;
}

export interface PhotoPostBody {
  media_type: "PHOTO";
  post_mode: "DIRECT_POST" | "MEDIA_UPLOAD";
  post_info: {
    title: string;
    description: string;
    privacy_level?: PrivacyLevel;
    disable_comment?: boolean;
    auto_add_music?: boolean;
  };
  source_info: {
    source: "PULL_FROM_URL";
    photo_cover_index: number;
    photo_images: string[];
  };
  is_aigc?: boolean;
}

export interface PublishStatus {
  status: PostStatus;
  failReason: string | null;
  postIds: string[];
}

/** Everything the app needs from TikTok. Live = open.tiktokapis.com, Mock = in-process fake. */
export interface TikTokGateway {
  /** Runs the whole browser login and returns the token grant. */
  authorize(scopes: string[]): Promise<TokenGrant>;
  refresh(refreshToken: string): Promise<TokenGrant>;
  revoke(accessToken: string): Promise<void>;
  userInfo(accessToken: string): Promise<UserInfo>;
  creatorInfo(accessToken: string): Promise<CreatorInfo>;
  /** postInfo present = direct post (/video/init/); absent = draft (/inbox/video/init/). */
  initVideo(
    accessToken: string,
    source: FileUploadSource,
    postInfo: VideoPostInfo | null,
  ): Promise<{ publishId: string; uploadUrl: string }>;
  uploadChunk(uploadUrl: string, chunk: Buffer, first: number, total: number, contentType: string): Promise<void>;
  initPhoto(accessToken: string, body: PhotoPostBody): Promise<{ publishId: string }>;
  fetchStatus(accessToken: string, publishId: string): Promise<PublishStatus>;
}

/** An error TikTok returned; `code` is TikTok's error.code (e.g. "spam_risk_too_many_posts"). */
export class TikTokError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly logId?: string,
  ) {
    super(message);
    this.name = "TikTokError";
  }
}
