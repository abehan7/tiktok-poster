import type { Account, CreatorInfo } from "@shared/contract";
import { describeTikTokError } from "@shared/tiktokErrors";
import type { SettingsStore } from "../store/settings";
import type { StoredAccount, TokenStore } from "../store/tokens";
import { LiveTikTokGateway } from "./LiveTikTokGateway";
import { MockTikTokGateway } from "./MockTikTokGateway";
import { TikTokError, type TikTokGateway, type TokenGrant } from "./TikTokGateway";

const MOCK_KEY = "mock";
/** Refresh a little before expiry so a long upload doesn't straddle it. */
const REFRESH_MARGIN_MS = 10 * 60_000;
/** How long a login check stays fresh before listing the accounts checks again. */
const RECHECK_MS = 10 * 60_000;
/** Error codes that mean the login itself is gone, so only connecting again helps. */
const DEAD_LOGIN_CODES = ["access_token_invalid", "auth_removed", "invalid_grant", "scope_not_authorized"];

/**
 * Owns the connected accounts: picks the live or mock gateway from settings,
 * stores each account's tokens, and hands out access tokens that are always fresh.
 */
export class TikTokSession {
  private readonly mock = new MockTikTokGateway();
  /** When each account's login was last checked (this also re-fetches the profile; avatar URLs are signed and expire). */
  private readonly checkedAt = new Map<string, number>();

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
    this.checkedAt.set(tokens.openId, Date.now());
    return toAccount(stored);
  }

  async disconnect(openId: string): Promise<void> {
    const a = this.tokens.get(this.appKey(), openId);
    if (a) await this.gateway().revoke(a.tokens.accessToken).catch(() => undefined);
    this.tokens.remove(this.appKey(), openId);
    this.checkedAt.delete(openId);
  }

  /** Connected accounts whose login hasn't expired, oldest first. Checks each login (and refreshes its profile) every few minutes. */
  async listAccounts(): Promise<Account[]> {
    const now = Date.now();
    const live = this.tokens.list(this.appKey()).filter((a) => a.tokens.refreshExpiresAt > now);
    await Promise.all(
      live
        .filter((a) => now - (this.checkedAt.get(a.tokens.openId) ?? 0) > RECHECK_MS)
        .map(async (a) => {
          const id = a.tokens.openId;
          this.checkedAt.set(id, now);
          try {
            const profile = await this.profile(await this.accessToken(id), a.tokens.scopes);
            Object.assign(a, this.patch(id, { ...profile, loginProblem: null }));
          } catch (err) {
            // A refused login is flagged on the account; offline just keeps the cached profile.
            const problem = deadLoginMessage(err);
            if (problem) Object.assign(a, this.patch(id, { loginProblem: problem }));
          }
        }),
    );
    return live.sort((x, y) => x.connectedAt.localeCompare(y.connectedAt)).map(toAccount);
  }

  /** Records what a post learned about the login: an error flags a refused login, no error clears the flag. */
  noteLogin(openId: string, err?: unknown): void {
    const a = this.tokens.get(this.appKey(), openId);
    if (!a) return;
    const problem = err === undefined ? null : deadLoginMessage(err);
    if (err !== undefined && !problem) return;
    this.checkedAt.set(openId, Date.now());
    if ((a.loginProblem ?? null) !== problem) this.patch(openId, { loginProblem: problem });
  }

  private patch(openId: string, patch: Partial<StoredAccount>): StoredAccount {
    const next = { ...this.tokens.get(this.appKey(), openId)!, ...patch };
    this.tokens.put(this.appKey(), next);
    return next;
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
    loginProblem: a.loginProblem ?? null,
  };
}

function deadLoginMessage(err: unknown): string | null {
  return err instanceof TikTokError && DEAD_LOGIN_CODES.includes(err.code) ? describeTikTokError(err.code, err.message) : null;
}
