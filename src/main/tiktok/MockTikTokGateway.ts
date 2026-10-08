import { randomBytes } from "node:crypto";
import type { CreatorInfo } from "@shared/contract";
import type {
  FileUploadSource,
  PhotoPostBody,
  PublishStatus,
  TikTokGateway,
  TokenGrant,
  UserInfo,
  VideoPostInfo,
} from "./TikTokGateway";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MockPublish {
  kind: "video" | "photo";
  direct: boolean;
  startedAt: number;
}

/**
 * In-process fake TikTok used while no client key is configured, so the whole
 * UI (login, upload progress, status polling) can be exercised offline.
 */
export class MockTikTokGateway implements TikTokGateway {
  private readonly publishes = new Map<string, MockPublish>();

  async authorize(scopes: string[]): Promise<TokenGrant> {
    await sleep(600);
    return {
      accessToken: `mock-at-${randomBytes(6).toString("hex")}`,
      refreshToken: `mock-rt-${randomBytes(6).toString("hex")}`,
      expiresIn: 86_400,
      refreshExpiresIn: 31_536_000,
      openId: "mock-open-id",
      scopes,
    };
  }

  refresh(): Promise<TokenGrant> {
    return this.authorize(["user.info.basic", "video.upload", "video.publish"]);
  }

  async revoke(): Promise<void> {}

  async userInfo(): Promise<UserInfo> {
    return { openId: "mock-open-id", displayName: "TubeLingo (mock)", avatarUrl: null };
  }

  async creatorInfo(): Promise<CreatorInfo> {
    await sleep(200);
    return {
      username: "tubelingo.mock",
      nickname: "TubeLingo (mock)",
      avatarUrl: null,
      privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      maxVideoPostDurationSec: 600,
    };
  }

  async initVideo(_t: string, _s: FileUploadSource, postInfo: VideoPostInfo | null) {
    await sleep(300);
    const publishId = `v_pub_mock_${randomBytes(5).toString("hex")}`;
    this.publishes.set(publishId, { kind: "video", direct: Boolean(postInfo), startedAt: Date.now() });
    return { publishId, uploadUrl: `mock://upload/${publishId}` };
  }

  async uploadChunk(): Promise<void> {
    await sleep(700);
  }

  async initPhoto(_t: string, body: PhotoPostBody) {
    await sleep(400);
    const publishId = `p_pub_mock_${randomBytes(5).toString("hex")}`;
    this.publishes.set(publishId, {
      kind: "photo",
      direct: body.post_mode === "DIRECT_POST",
      startedAt: Date.now(),
    });
    return { publishId };
  }

  async fetchStatus(_t: string, publishId: string): Promise<PublishStatus> {
    const p = this.publishes.get(publishId);
    if (!p) return { status: "FAILED", failReason: "internal", postIds: [] };
    if (Date.now() - p.startedAt < 5000) {
      return {
        status: p.kind === "photo" ? "PROCESSING_DOWNLOAD" : "PROCESSING_UPLOAD",
        failReason: null,
        postIds: [],
      };
    }
    return p.direct
      ? { status: "PUBLISH_COMPLETE", failReason: null, postIds: ["7300000000000000000"] }
      : { status: "SEND_TO_USER_INBOX", failReason: null, postIds: [] };
  }
}
