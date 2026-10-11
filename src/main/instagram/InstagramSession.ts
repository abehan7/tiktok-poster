import type { BrowserWindow } from "electron";
import type { IgAccount } from "@shared/contract";
import type { SettingsStore } from "../store/settings";
import type { IgTokenStore, StoredIgAccount } from "../store/igTokens";
import { InstagramError, type IgProfile, type IgTokenGrant, type InstagramGateway } from "./InstagramGateway";
import { LiveInstagramGateway } from "./LiveInstagramGateway";
import { MockInstagramGateway } from "./MockInstagramGateway";

const DAY = 86_400_000;
/** Refresh once a token is this old (Instagram requires ≥ 24h), so it never gets near its 60 days. */
const REFRESH_AFTER_MS = 7 * DAY;
/** How long a login check stays fresh before listing the accounts checks again. */
const RECHECK_MS = 10 * 60_000;

/**
 * Owns the connected Instagram accounts: picks the live or mock gateway,
 * stores each account's long-lived token, and keeps those tokens refreshed.
 */
export class InstagramSession {
  private readonly mock = new MockInstagramGateway();
  /** When each account's login was last checked (this also re-fetches the profile; avatar URLs are signed and expire). */
  private readonly checkedAt = new Map<string, number>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly tokens: IgTokenStore,
    private readonly window: () => BrowserWindow | null,
  ) {}

  gateway(): InstagramGateway {
    const s = this.settings.get();
    if (s.mockMode) return this.mock;
    return new LiveInstagramGateway({ ...s.instagram, window: this.window });
  }

  private set(): string {
    return this.settings.get().mockMode ? "mock" : "live";
  }

  /** Instagram Login in an app window. */
  async connect(): Promise<IgAccount> {
    return this.add(await this.gateway().authorize());
  }

  /** A long-lived token from the App Dashboard ("Generate token"). */
  async addToken(token: string): Promise<IgAccount> {
    const t = token.trim();
    if (!t) throw new Error("Paste an Instagram access token.");
    if (this.settings.get().mockMode) return this.add({ accessToken: this.mock.tokenFor(t), expiresIn: 60 * 86_400 });
    if (!/^IG/.test(t)) {
      throw new Error("That doesn't look like an Instagram token (they start with “IG”). Facebook Page tokens don't work here.");
    }
    // Dashboard tokens are long-lived (60 days) but don't say when they were issued; assume now.
    return this.add({ accessToken: t, expiresIn: 60 * 86_400 });
  }

  private async add(grant: IgTokenGrant): Promise<IgAccount> {
    const profile = await this.gateway().profile(grant.accessToken);
    if (profile.accountType && !["BUSINESS", "MEDIA_CREATOR"].includes(profile.accountType)) {
      throw new Error(`@${profile.username} is a personal account. Switch it to a Professional (Creator or Business) account in Instagram first.`);
    }
    const existing = this.tokens.get(this.set(), profile.id);
    const now = Date.now();
    const stored: StoredIgAccount = {
      ...profile,
      note: existing?.note ?? "",
      connectedAt: existing?.connectedAt ?? new Date(now).toISOString(),
      accessToken: grant.accessToken,
      issuedAt: now,
      expiresAt: now + grant.expiresIn * 1000,
    };
    this.tokens.put(this.set(), stored);
    this.checkedAt.set(profile.id, now);
    return toIgAccount(stored);
  }

  disconnect(id: string): void {
    // Instagram has no revoke endpoint for these tokens; removing it here is all the app can do.
    this.tokens.remove(this.set(), id);
    this.checkedAt.delete(id);
  }

  /** Connected accounts whose token hasn't expired, oldest first. Checks each login (and refreshes its profile) every few minutes. */
  async listAccounts(): Promise<IgAccount[]> {
    const now = Date.now();
    const live = this.tokens.list(this.set()).filter((a) => a.expiresAt > now);
    await Promise.all(
      live
        .filter((a) => now - (this.checkedAt.get(a.id) ?? 0) > RECHECK_MS)
        .map(async (a) => {
          this.checkedAt.set(a.id, now);
          try {
            const token = await this.accessToken(a.id);
            const profile: Partial<IgProfile> = await this.gateway().profile(token);
            delete profile.id;
            Object.assign(a, this.patch(a.id, { ...profile, loginProblem: null }));
          } catch (err) {
            // A refused token is flagged on the account; offline just keeps what we have.
            if (isDeadLogin(err)) Object.assign(a, this.patch(a.id, { loginProblem: err.message }));
          }
        }),
    );
    return live.sort((x, y) => x.connectedAt.localeCompare(y.connectedAt)).map(toIgAccount);
  }

  /** Records what a post learned about the login: an error flags a refused token, no error clears the flag. */
  noteLogin(id: string, err?: unknown): void {
    const a = this.stored(id);
    if (!a) return;
    if (err === undefined) {
      this.checkedAt.set(id, Date.now());
      if (a.loginProblem) this.patch(id, { loginProblem: null });
    } else if (isDeadLogin(err)) {
      this.checkedAt.set(id, Date.now());
      this.patch(id, { loginProblem: err.message });
    }
  }

  stored(id: string): StoredIgAccount | null {
    return this.tokens.get(this.set(), id);
  }

  setNote(id: string, note: string): void {
    if (!this.stored(id)) throw new Error("That Instagram account isn't connected.");
    this.patch(id, { note: note.trim().slice(0, 200) });
  }

  /** A usable token, refreshed first when it's due. A failed refresh keeps the old token while it's still valid. */
  async accessToken(id: string): Promise<string> {
    const a = this.stored(id);
    if (!a) throw new Error("That Instagram account isn't connected. Connect it again.");
    if (a.expiresAt < Date.now()) {
      this.tokens.remove(this.set(), id);
      throw new Error(`The Instagram login for @${a.username} expired. Connect it again.`);
    }
    if (Date.now() - a.issuedAt < REFRESH_AFTER_MS) return a.accessToken;
    try {
      const fresh = await this.gateway().refresh(a.accessToken);
      this.patch(id, { accessToken: fresh.accessToken, issuedAt: Date.now(), expiresAt: Date.now() + fresh.expiresIn * 1000 });
      return fresh.accessToken;
    } catch {
      return a.accessToken;
    }
  }

  private patch(id: string, patch: Partial<StoredIgAccount>): StoredIgAccount {
    const next = { ...this.stored(id)!, ...patch };
    this.tokens.put(this.set(), next);
    return next;
  }
}

function toIgAccount(a: StoredIgAccount): IgAccount {
  return {
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    accountType: a.accountType,
    note: a.note ?? "",
    connectedAt: a.connectedAt,
    expiresAt: new Date(a.expiresAt).toISOString(),
    loginProblem: a.loginProblem ?? null,
  };
}

/** Instagram refused the token itself (code 190), so only connecting again helps. */
function isDeadLogin(err: unknown): err is InstagramError {
  return err instanceof InstagramError && err.code === 190;
}
