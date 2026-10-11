import type { BrowserWindow } from "electron";
import {
  InstagramError,
  type ContainerSpec,
  type ContainerState,
  type ContainerStatus,
  type IgProfile,
  type IgTokenGrant,
  type InstagramGateway,
} from "./InstagramGateway";
import { waitForInstagramCode } from "./login";

const GRAPH = "https://graph.instagram.com";
const VERSION = "v25.0";
const AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

interface Credentials {
  appId: string;
  appSecret: string;
  redirectUri: string;
  window: () => BrowserWindow | null;
}

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
}

/** Meta error codes / subcodes that need a plainer explanation than the API's text. */
const MESSAGES: Record<number, string> = {
  190: "The Instagram login expired or was revoked. Connect the account again.",
  10: "This Instagram account didn't grant publishing permission. Connect it again.",
  4: "Too many requests to Instagram. Wait a while and try again.",
  17: "Too many requests to Instagram. Wait a while and try again.",
  613: "Too many requests to Instagram. Wait a while and try again.",
  2207042: "This account hit Instagram's limit of 100 API posts per 24 hours.",
  2207026: "Instagram can't use this video format. Use MP4/MOV with H.264 or HEVC video and AAC audio.",
  2207052: "Instagram couldn't download the media from R2. Check the R2 public URL in Settings.",
  2207009: "Instagram doesn't accept this image's aspect ratio (it needs 4:5 to 1.91:1).",
  36003: "Instagram doesn't accept this image's aspect ratio (it needs 4:5 to 1.91:1).",
};

/** graph.instagram.com — Instagram API with Instagram Login (business/creator accounts). */
export class LiveInstagramGateway implements InstagramGateway {
  constructor(private readonly creds: Credentials) {}

  async authorize(): Promise<IgTokenGrant> {
    const { appId, appSecret, redirectUri } = this.creds;
    if (!appId || !appSecret) throw new Error("Add the Instagram app ID and secret in Settings first, or paste a token instead.");
    const code = await waitForInstagramCode({
      redirectUri,
      parent: this.creds.window(),
      authorizeUrl: (state) =>
        `${AUTHORIZE}?${new URLSearchParams({
          client_id: appId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES.join(","),
          state,
          enable_fb_login: "false",
        })}`,
    });

    // Code → short-lived token (1h) → long-lived token (60 days).
    const res = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const short = (await res.json()) as {
      access_token?: string;
      data?: { access_token: string }[];
      error_message?: string;
      error?: GraphError;
    };
    const shortToken = short.access_token ?? short.data?.[0]?.access_token;
    if (!shortToken) throw graphError(short.error ?? { message: short.error_message ?? `HTTP ${res.status}` });

    const long = await this.get<{ access_token: string; expires_in: number }>("/access_token", {
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: shortToken,
    });
    return { accessToken: long.access_token, expiresIn: long.expires_in };
  }

  async refresh(accessToken: string): Promise<IgTokenGrant> {
    const r = await this.get<{ access_token: string; expires_in: number }>("/refresh_access_token", {
      grant_type: "ig_refresh_token",
      access_token: accessToken,
    });
    return { accessToken: r.access_token, expiresIn: r.expires_in };
  }

  async profile(accessToken: string): Promise<IgProfile> {
    const me = await this.get<{
      id: string;
      user_id?: string;
      username: string;
      name?: string;
      profile_picture_url?: string;
      account_type?: string;
    }>(`/${VERSION}/me`, { fields: "user_id,username,name,profile_picture_url,account_type", access_token: accessToken });
    return {
      id: me.user_id ?? me.id,
      username: me.username,
      displayName: me.name || me.username,
      avatarUrl: me.profile_picture_url ?? null,
      accountType: me.account_type ?? null,
    };
  }

  async createContainer(accessToken: string, igUserId: string, spec: ContainerSpec): Promise<string> {
    const params: Record<string, string> = {};
    if (spec.kind === "image") {
      params.image_url = spec.imageUrl;
      if (spec.carouselItem) params.is_carousel_item = "true";
      if (spec.caption) params.caption = spec.caption;
    } else if (spec.kind === "carousel") {
      params.media_type = "CAROUSEL";
      params.children = spec.children.join(",");
      params.caption = spec.caption;
    } else {
      params.media_type = "REELS";
      params.video_url = spec.videoUrl;
      params.caption = spec.caption;
      params.thumb_offset = String(Math.max(0, Math.round(spec.thumbOffsetMs)));
      params.share_to_feed = String(spec.shareToFeed);
    }
    const r = await this.post<{ id: string }>(`/${VERSION}/${igUserId}/media`, accessToken, params);
    return r.id;
  }

  async containerStatus(accessToken: string, containerId: string): Promise<ContainerState> {
    const r = await this.get<{ status_code: ContainerStatus; status?: string }>(`/${VERSION}/${containerId}`, {
      fields: "status_code,status",
      access_token: accessToken,
    });
    // `status` reads like "Error: Media upload has failed with error code 2207026" when it failed.
    const sub = Number(/error code (\d+)/i.exec(r.status ?? "")?.[1]);
    return {
      status: r.status_code,
      detail: r.status_code === "ERROR" ? (MESSAGES[sub] ?? r.status ?? "Instagram couldn't process the media.") : null,
    };
  }

  async publish(accessToken: string, igUserId: string, containerId: string): Promise<string> {
    const r = await this.post<{ id: string }>(`/${VERSION}/${igUserId}/media_publish`, accessToken, { creation_id: containerId });
    return r.id;
  }

  async permalink(accessToken: string, mediaId: string): Promise<string | null> {
    const r = await this.get<{ permalink?: string }>(`/${VERSION}/${mediaId}`, { fields: "permalink", access_token: accessToken });
    return r.permalink ?? null;
  }

  private async get<T>(path: string, query: Record<string, string>): Promise<T> {
    return this.parse<T>(await fetch(`${GRAPH}${path}?${new URLSearchParams(query)}`));
  }

  private async post<T>(path: string, accessToken: string, body: Record<string, string>): Promise<T> {
    return this.parse<T>(
      await fetch(`${GRAPH}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: new URLSearchParams(body),
      }),
    );
  }

  private async parse<T>(res: Response): Promise<T> {
    let json: T & { error?: GraphError };
    try {
      json = (await res.json()) as T & { error?: GraphError };
    } catch {
      throw new InstagramError(`Instagram returned HTTP ${res.status} with no JSON body.`, null);
    }
    if (json.error || !res.ok) throw graphError(json.error ?? { message: `HTTP ${res.status}` });
    return json;
  }
}

/** Code 190 covers several causes; Meta's text says which. */
function invalidTokenMessage(e: GraphError): string {
  const m = e.message ?? "";
  if (/changed their password|security reasons|session has been invalidated/i.test(m)) {
    return "Instagram ended this login: the password was changed or Instagram reset the session for security. Check the account in the Instagram app, then connect it again.";
  }
  if (/has expired|session has expired/i.test(m)) return "The Instagram login expired. Connect the account again.";
  if (/not authorized application|has not authorized/i.test(m)) return "This Instagram account removed the app's access. Connect it again.";
  return MESSAGES[190];
}

function graphError(e: GraphError): InstagramError {
  if (e.code === 190) return new InstagramError(invalidTokenMessage(e), 190, e.error_subcode ?? null);
  const known = (e.error_subcode && MESSAGES[e.error_subcode]) || (e.code !== undefined && MESSAGES[e.code]);
  const text = known || e.error_user_msg || e.message || "Instagram returned an error.";
  return new InstagramError(text, e.code ?? null, e.error_subcode ?? null);
}
