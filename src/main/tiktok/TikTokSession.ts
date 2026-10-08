import type { Account, CreatorInfo } from "@shared/contract";
import type { SettingsStore } from "../store/settings";
import type { StoredAccount, TokenStore } from "../store/tokens";
import { LiveTikTokGateway } from "./LiveTikTokGateway";
import { MockTikTokGateway } from "./MockTikTokGateway";
import type { TikTokGateway, TokenGrant } from "./TikTokGateway";

const MOCK_KEY = "mock";
/** Refresh a little before expiry so a long upload doesn't straddle it. */
const REFRESH_MARGIN_MS = 10 * 60_000;

/**
 * Owns the connected accounts: picks the live or mock gateway from settings,
 * stores each account's tokens, and hands out access tokens that are always fresh.
 */
export class TikTokSession {
  private readonly mock = new MockTikTokGateway();
  /** Profiles re-fetched this launch (TikTok avatar URLs are signed and expire). */
  private readonly refreshed = new Set<string>();

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

  private appKey(): string {
    const s = this.settings.get();
    return s.mockMode ? MOCK_KEY : s.clientKey;
  }

  scopes(): string[] {
    const scopes = ["user.info.basic", "video.upload"];
    if (this.settings.get().directPostEnabled) scopes.push("video.publish");
    return scopes;
  }

  /** Runs the browser login and adds (or re-authorizes) whichever account signs in. */
  async connect(): Promise<Account> {
    const grant = await this.gateway().authorize(this.scopes());
    const tokens = this.toTokens(grant);
    const profile = await this.profile(tokens.accessToken, tokens.scopes);
    const existing = this.tokens.get(this.appKey(), tokens.openId);
    const stored: StoredAccount = {
      tokens,
      ...profile,
      note: existing?.note ?? "",
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
    };
    this.tokens.put(this.appKey(), stored);
    this.refreshed.add(tokens.openId);
    return toAccount(stored);
  }

  async disconnect(openId: string): Promise<void> {
    const a = this.tokens.get(this.appKey(), openId);
    if (a) await this.gateway().revoke(a.tokens.accessToken).catch(() => undefined);
    this.tokens.remove(this.appKey(), openId);
    this.refreshed.delete(openId);
  }

  /** Connected accounts whose login hasn't expired, oldest first. */
  async listAccounts(): Promise<Account[]> {
    const live = this.tokens.list(this.appKey()).filter((a) => a.tokens.refreshExpiresAt > Date.now());
    // Refresh names/avatars once per launch; a failure just keeps the cached profile.
    await Promise.all(
      live
        .filter((a) => !this.refreshed.has(a.tokens.openId))
        .map(async (a) => {
          this.refreshed.add(a.tokens.openId);
          try {
            const profile = await this.profile(await this.accessToken(a.tokens.openId), a.tokens.scopes);
            this.tokens.put(this.appKey(), { ...this.tokens.get(this.appKey(), a.tokens.openId)!, ...profile });
            Object.assign(a, profile);
          } catch {
            // offline or token revoked — show what we have
          }
        }),
    );
    return live.sort((x, y) => x.connectedAt.localeCompare(y.connectedAt)).map(toAccount);
  }

  storedAccount(openId: string): StoredAccount | null {
    return this.tokens.get(this.appKey(), openId);
  }

  setNote(openId: string, note: string): void {
    const a = this.tokens.get(this.appKey(), openId);
    if (!a) throw new Error("That TikTok account isn't connected.");
    this.tokens.put(this.appKey(), { ...a, note: note.trim().slice(0, 200) });
  }

  /** Name + avatar (user.info.basic) and @handle (creator_info, needs video.publish). */
  private async profile(accessToken: string, scopes: string[]) {
    const info = await this.gateway().userInfo(accessToken);
    let username: string | null = null;
    if (scopes.includes("video.publish")) {
      username = await this.gateway()
        .creatorInfo(accessToken)
        .then((c) => c.username || null)
        .catch(() => null);
    }
    return { displayName: info.displayName, avatarUrl: info.avatarUrl, username };
  }

  async creatorInfo(openId: string): Promise<CreatorInfo> {
    return this.gateway().creatorInfo(await this.accessToken(openId));
  }

  async accessToken(openId: string): Promise<string> {
    const a = this.tokens.get(this.appKey(), openId);
    if (!a) throw new Error("That TikTok account isn't connected. Connect it again.");
    const t = a.tokens;
    if (t.accessExpiresAt - REFRESH_MARGIN_MS > Date.now()) return t.accessToken;
    if (t.refreshExpiresAt < Date.now()) {
      this.tokens.remove(this.appKey(), openId);
      throw new Error(`The login for ${a.displayName} expired. Connect it again.`);
    }
    const fresh = this.toTokens(await this.gateway().refresh(t.refreshToken), t.openId);
    this.tokens.put(this.appKey(), { ...this.tokens.get(this.appKey(), openId)!, tokens: fresh });
    return fresh.accessToken;
  }

  private toTokens(grant: TokenGrant, openId = grant.openId) {
    const now = Date.now();
    return {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      accessExpiresAt: now + grant.expiresIn * 1000,
      refreshExpiresAt: now + grant.refreshExpiresIn * 1000,
      openId: grant.openId || openId,
      scopes: grant.scopes,
    };
  }
}

function toAccount(a: StoredAccount): Account {
  return {
    openId: a.tokens.openId,
    displayName: a.displayName,
    username: a.username ?? null,
    avatarUrl: a.avatarUrl,
    note: a.note ?? "",
    scopes: a.tokens.scopes,
    connectedAt: a.connectedAt,
  };
}
