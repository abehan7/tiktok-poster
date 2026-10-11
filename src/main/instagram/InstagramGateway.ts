export interface IgTokenGrant {
  accessToken: string;
  /** Seconds until the token expires. */
  expiresIn: number;
}

export interface IgProfile {
  /** Professional account ID used in publishing calls. */
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accountType: string | null;
}

/** IN_PROGRESS → FINISHED (ready to publish) → PUBLISHED; or ERROR / EXPIRED (not published within 24h). */
export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export interface ContainerState {
  status: ContainerStatus;
  /** Instagram's explanation when status is ERROR. */
  detail: string | null;
}

/** Media container fields for POST /<IG_ID>/media. */
export type ContainerSpec =
  | { kind: "image"; imageUrl: string; caption?: string; carouselItem?: boolean }
  | { kind: "carousel"; children: string[]; caption: string }
  | { kind: "reel"; videoUrl: string; caption: string; thumbOffsetMs: number; shareToFeed: boolean };

/** Everything the app needs from Instagram. Live = graph.instagram.com, Mock = in-process fake. */
export interface InstagramGateway {
  /** Runs Instagram Login in an app window and returns a long-lived token. */
  authorize(): Promise<IgTokenGrant>;
  /** Extends a long-lived token by another 60 days (it must be at least 24h old). */
  refresh(accessToken: string): Promise<IgTokenGrant>;
  profile(accessToken: string): Promise<IgProfile>;
  createContainer(accessToken: string, igUserId: string, spec: ContainerSpec): Promise<string>;
  containerStatus(accessToken: string, containerId: string): Promise<ContainerState>;
  /** Publishes a FINISHED container; returns the new media ID. */
  publish(accessToken: string, igUserId: string, containerId: string): Promise<string>;
  permalink(accessToken: string, mediaId: string): Promise<string | null>;
}

/** An error the Graph API returned, already in plain words. `code` is Meta's numeric error code. */
export class InstagramError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly subcode: number | null = null,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}
