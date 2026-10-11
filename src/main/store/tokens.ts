import { JsonFile } from "./jsonFile";
import { seal, unseal } from "./secrets";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  accessExpiresAt: number;
  refreshExpiresAt: number;
  openId: string;
  scopes: string[];
}

/** Profile cached at connect time so the account list renders without API calls. */
export interface StoredAccount {
  tokens: Tokens;
  displayName: string;
  username?: string | null;
  avatarUrl: string | null;
  note?: string;
  connectedAt: string;
  /** Set when TikTok refused the login (revoked, refresh token rejected…); cleared when it works again. */
  loginProblem?: string | null;
}

interface StoredTokens {
  /** clientKey (or "mock") → openId → sealed StoredAccount JSON, in connection order. */
  apps: Record<string, Record<string, string>>;
  /** Pre-multi-account format: one sealed Tokens blob for `clientKey`. Migrated on read. */
  sealed?: string;
  clientKey?: string;
}

const empty = (): StoredTokens => ({ apps: {} });

/** Connected accounts' OAuth tokens, encrypted at rest, grouped by TikTok app. */
export class TokenStore {
  private readonly file = new JsonFile<StoredTokens>("tokens.json", empty);

  private read(clientKey: string): Record<string, StoredAccount> {
    const s = this.file.read();
    const out: Record<string, StoredAccount> = {};
    for (const [openId, sealed] of Object.entries(s.apps?.[clientKey] ?? {})) {
      try {
        out[openId] = JSON.parse(unseal(sealed)) as StoredAccount;
      } catch {
        // Unreadable (e.g. keychain reset): treat as disconnected.
      }
    }
    if (s.sealed && s.clientKey === clientKey) {
      try {
        const tokens = JSON.parse(unseal(s.sealed)) as Tokens;
        out[tokens.openId] ??= {
          tokens,
          displayName: "TikTok account",
          avatarUrl: null,
          connectedAt: new Date().toISOString(),
        };
      } catch {
        // ignore
      }
    }
    return out;
  }

  private write(clientKey: string, accounts: Record<string, StoredAccount>): void {
    const s = this.file.read();
    const apps = { ...(s.apps ?? {}) };
    // Carry a legacy single-account login for another app over before dropping the old fields.
    if (s.sealed && s.clientKey && s.clientKey !== clientKey) {
      const legacy = JSON.parse(unseal(s.sealed) || "null") as Tokens | null;
      if (legacy) apps[s.clientKey] = { ...(apps[s.clientKey] ?? {}), [legacy.openId]: seal(JSON.stringify({ tokens: legacy, displayName: "TikTok account", avatarUrl: null, connectedAt: new Date().toISOString() })) };
    }
    apps[clientKey] = Object.fromEntries(Object.entries(accounts).map(([id, a]) => [id, seal(JSON.stringify(a))]));
    this.file.write({ apps });
  }

  list(clientKey: string): StoredAccount[] {
    return Object.values(this.read(clientKey));
  }

  get(clientKey: string, openId: string): StoredAccount | null {
    return this.read(clientKey)[openId] ?? null;
  }

  put(clientKey: string, account: StoredAccount): void {
    const all = this.read(clientKey);
    all[account.tokens.openId] = account;
    this.write(clientKey, all);
  }

  remove(clientKey: string, openId: string): void {
    const all = this.read(clientKey);
    delete all[openId];
    this.write(clientKey, all);
  }
}
