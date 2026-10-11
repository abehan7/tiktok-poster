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

const accountOf = (token: string) => Number(/^mock-(?:at|rt)-(\d+)-/.exec(token)?.[1] ?? 0);

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
  private logins = 0;
  private static readonly NAMES = ["Demo Creator (mock)", "Demo Studio (mock)", "Demo Clips (mock)"];

  async authorize(scopes: string[]): Promise<TokenGrant> {
    await sleep(600);
    // Each browser login "signs in" the next mock account.
    return this.grant(this.logins++ % MockTikTokGateway.NAMES.length, scopes);
  }

  async refresh(refreshToken: string): Promise<TokenGrant> {
    return this.grant(accountOf(refreshToken), ["user.info.basic", "video.upload", "video.publish"]);
  }

  private grant(n: number, scopes: string[]): TokenGrant {
    // The account number lives in the token so it survives app restarts.
    const accessToken = `mock-at-${n}-${randomBytes(6).toString("hex")}`;
    const refreshToken = `mock-rt-${n}-${randomBytes(6).toString("hex")}`;
    return { accessToken, refreshToken, expiresIn: 86_400, refreshExpiresIn: 31_536_000, openId: `mock-open-id-${n}`, scopes };
  }

  private who(accessToken: string) {
    const n = accountOf(accessToken);
    const name = MockTikTokGateway.NAMES[n] ?? `Mock ${n}`;
    return { n, name, username: name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") };
  }

  async revoke(): Promise<void> {}

  async userInfo(accessToken: string): Promise<UserInfo> {
    const w = this.who(accessToken);
    return { openId: `mock-open-id-${w.n}`, displayName: w.name, avatarUrl: null };
  }

  async creatorInfo(accessToken: string): Promise<CreatorInfo> {
    await sleep(200);
    const w = this.who(accessToken);
    return {
      username: w.username,
      nickname: w.name,
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
