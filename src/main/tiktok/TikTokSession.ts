import type { Account, CreatorInfo } from "@shared/contract";
import type { SettingsStore } from "../store/settings";
import type { TokenStore } from "../store/tokens";
import { LiveTikTokGateway } from "./LiveTikTokGateway";
import { MockTikTokGateway } from "./MockTikTokGateway";
import type { TikTokGateway, TokenGrant } from "./TikTokGateway";

const MOCK_KEY = "mock";
/** Refresh a little before expiry so a long upload doesn't straddle it. */
const REFRESH_MARGIN_MS = 10 * 60_000;

/**
 * Owns the connected account: picks the live or mock gateway from settings,
 * stores tokens, and hands out an access token that is always fresh.
 */
export class TikTokSession {
  private readonly mock = new MockTikTokGateway();
  private account: Account | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly tokens: TokenStore,
  ) {}

  gateway(): TikTokGateway {
    const s = this.settings.get();
    if (s.mockMode) return this.mock;
    return new LiveTikTokGateway({
      clientKey: s.clientKey,
      clientSecret: s.clientSecret,
      redirectUri: s.redirectUri,
      port: s.oauthPort,
    });
  }

  private tokenKey(): string {
    const s = this.settings.get();
    return s.mockMode ? MOCK_KEY : s.clientKey;
  }

  scopes(): string[] {
    const scopes = ["user.info.basic", "video.upload"];
    if (this.settings.get().directPostEnabled) scopes.push("video.publish");
    return scopes;
  }

  async connect(): Promise<Account> {
    const grant = await this.gateway().authorize(this.scopes());
    this.save(grant);
    this.account = null;
    return (await this.getAccount())!;
  }

  async disconnect(): Promise<void> {
    const t = this.tokens.get(this.tokenKey());
    if (t) await this.gateway().revoke(t.accessToken).catch(() => undefined);
    this.tokens.clear();
    this.account = null;
  }

  async getAccount(): Promise<Account | null> {
    const t = this.tokens.get(this.tokenKey());
    if (!t || t.refreshExpiresAt < Date.now()) {
      this.account = null;
      return null;
    }
    if (this.account?.openId === t.openId) return this.account;
    const info = await this.gateway().userInfo(await this.accessToken());
    this.account = { ...info, scopes: t.scopes };
    return this.account;
  }

  async creatorInfo(): Promise<CreatorInfo> {
    return this.gateway().creatorInfo(await this.accessToken());
  }

  async accessToken(): Promise<string> {
    const t = this.tokens.get(this.tokenKey());
    if (!t) throw new Error("Connect your TikTok account first.");
    if (t.accessExpiresAt - REFRESH_MARGIN_MS > Date.now()) return t.accessToken;
    if (t.refreshExpiresAt < Date.now()) {
      this.tokens.clear();
      throw new Error("TikTok login expired. Connect again.");
    }
    const grant = await this.gateway().refresh(t.refreshToken);
    return this.save(grant).accessToken;
  }

  private save(grant: TokenGrant) {
    const now = Date.now();
    const tokens = {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      accessExpiresAt: now + grant.expiresIn * 1000,
      refreshExpiresAt: now + grant.refreshExpiresIn * 1000,
      openId: grant.openId,
      scopes: grant.scopes,
    };
    this.tokens.set(this.tokenKey(), tokens);
    return tokens;
  }
}
