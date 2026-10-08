import type { CreatorInfo, PostStatus, PrivacyLevel } from "@shared/contract";
import { codeChallengeFor, createCodeVerifier, waitForAuthorizationCode } from "./oauth";
import {
  TikTokError,
  type FileUploadSource,
  type PhotoPostBody,
  type PublishStatus,
  type TikTokGateway,
  type TokenGrant,
  type UserInfo,
  type VideoPostInfo,
} from "./TikTokGateway";

const API = "https://open.tiktokapis.com";
const AUTHORIZE = "https://www.tiktok.com/v2/auth/authorize/";

interface Credentials {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  port: number;
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; log_id?: string; logid?: string };
}

interface RawToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  log_id?: string;
}

/** open.tiktokapis.com v2 — Login Kit (desktop, PKCE) + Content Posting API. */
export class LiveTikTokGateway implements TikTokGateway {
  constructor(private readonly creds: Credentials) {}

  async authorize(scopes: string[]): Promise<TokenGrant> {
    if (!this.creds.clientSecret) throw new Error("Add the TikTok client secret in Settings first.");
    const verifier = createCodeVerifier();
    const code = await waitForAuthorizationCode({
      port: this.creds.port,
      authorizeUrl: (state) => {
        const q = new URLSearchParams({
          client_key: this.creds.clientKey,
          response_type: "code",
          scope: scopes.join(","),
          redirect_uri: this.creds.redirectUri,
          state,
          code_challenge: codeChallengeFor(verifier),
          code_challenge_method: "S256",
        });
        return `${AUTHORIZE}?${q}`;
      },
    });
    return this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.creds.redirectUri,
      code_verifier: verifier,
    });
  }

  refresh(refreshToken: string): Promise<TokenGrant> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async revoke(accessToken: string): Promise<void> {
    await fetch(`${API}/v2/oauth/revoke/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: this.creds.clientKey,
        client_secret: this.creds.clientSecret,
        token: accessToken,
      }),
    });
  }

  async userInfo(accessToken: string): Promise<UserInfo> {
    const data = await this.call<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>(
      accessToken,
      "GET",
      "/v2/user/info/?fields=open_id,display_name,avatar_url",
    );
    return {
      openId: data.user.open_id,
      displayName: data.user.display_name ?? "TikTok user",
      avatarUrl: data.user.avatar_url ?? null,
    };
  }

  async creatorInfo(accessToken: string): Promise<CreatorInfo> {
    const d = await this.call<{
      creator_avatar_url?: string;
      creator_username: string;
      creator_nickname: string;
      privacy_level_options: PrivacyLevel[];
      comment_disabled: boolean;
      duet_disabled: boolean;
      stitch_disabled: boolean;
      max_video_post_duration_sec: number;
    }>(accessToken, "POST", "/v2/post/publish/creator_info/query/");
    return {
      username: d.creator_username,
      nickname: d.creator_nickname,
      avatarUrl: d.creator_avatar_url ?? null,
      privacyLevelOptions: d.privacy_level_options,
      commentDisabled: d.comment_disabled,
      duetDisabled: d.duet_disabled,
      stitchDisabled: d.stitch_disabled,
      maxVideoPostDurationSec: d.max_video_post_duration_sec,
    };
  }

  async initVideo(accessToken: string, source: FileUploadSource, postInfo: VideoPostInfo | null) {
    const path = postInfo ? "/v2/post/publish/video/init/" : "/v2/post/publish/inbox/video/init/";
    const body = postInfo ? { post_info: postInfo, source_info: source } : { source_info: source };
    const d = await this.call<{ publish_id: string; upload_url: string }>(accessToken, "POST", path, body);
    return { publishId: d.publish_id, uploadUrl: d.upload_url };
  }

  async uploadChunk(uploadUrl: string, chunk: Buffer, first: number, total: number, contentType: string) {
    const last = first + chunk.length - 1;
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${first}-${last}/${total}`,
      },
      body: new Uint8Array(chunk),
    });
    // 206 = chunk accepted, more expected; 201 = upload complete.
    if (res.status !== 206 && res.status !== 201 && !res.ok) {
      throw new TikTokError(`Chunk upload failed (HTTP ${res.status}): ${await res.text()}`, "upload_failed");
    }
  }

  async initPhoto(accessToken: string, body: PhotoPostBody) {
    const d = await this.call<{ publish_id: string }>(accessToken, "POST", "/v2/post/publish/content/init/", body);
    return { publishId: d.publish_id };
  }

  async fetchStatus(accessToken: string, publishId: string): Promise<PublishStatus> {
    const d = await this.call<{
      status: PostStatus;
      fail_reason?: string;
      // (sic) — TikTok's field name.
      publicaly_available_post_id?: (string | number)[];
    }>(accessToken, "POST", "/v2/post/publish/status/fetch/", { publish_id: publishId });
    return {
      status: d.status,
      failReason: d.fail_reason || null,
      postIds: (d.publicaly_available_post_id ?? []).map(String),
    };
  }

  private async token(params: Record<string, string>): Promise<TokenGrant> {
    const res = await fetch(`${API}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: this.creds.clientKey,
        client_secret: this.creds.clientSecret,
        ...params,
      }),
    });
    const raw = (await res.json()) as RawToken;
    if (!raw.access_token) {
      throw new TikTokError(raw.error_description || raw.error || `HTTP ${res.status}`, raw.error ?? "oauth_error", raw.log_id);
    }
    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token ?? "",
      expiresIn: raw.expires_in ?? 86_400,
      refreshExpiresIn: raw.refresh_expires_in ?? 31_536_000,
      openId: raw.open_id ?? "",
      scopes: (raw.scope ?? "").split(",").filter(Boolean),
    };
  }

  private async call<T>(accessToken: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(method === "POST" ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    let json: Envelope<T>;
    try {
      json = (await res.json()) as Envelope<T>;
    } catch {
      throw new TikTokError(`TikTok returned HTTP ${res.status} with no JSON body`, "bad_response");
    }
    const err = json.error;
    if (err && err.code !== "ok") {
      throw new TikTokError(err.message || err.code, err.code, err.log_id ?? err.logid);
    }
    if (!res.ok || !json.data) {
      throw new TikTokError(`TikTok returned HTTP ${res.status}`, "bad_response");
    }
    return json.data;
  }
}
