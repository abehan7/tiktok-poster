import { JsonFile } from "./jsonFile";
import { seal, unseal } from "./secrets";

export interface StoredIgAccount {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accountType: string | null;
  note: string;
  connectedAt: string;
  accessToken: string;
  /** Epoch ms the token was issued or last refreshed (refreshing needs it to be ≥ 24h old). */
  issuedAt: number;
  /** Epoch ms. */
  expiresAt: number;
  /** Set when Instagram refused the token (revoked, password changed…); cleared when it works again. */
  loginProblem?: string | null;
}

interface Doc {
  /** "live" or "mock" → account ID → sealed StoredIgAccount JSON, in connection order. */
  sets: Record<string, Record<string, string>>;
}

/** Connected Instagram accounts with their long-lived tokens, encrypted at rest. */
export class IgTokenStore {
  private readonly file = new JsonFile<Doc>("instagram.json", () => ({ sets: {} }));

  private read(set: string): Record<string, StoredIgAccount> {
    const out: Record<string, StoredIgAccount> = {};
    for (const [id, sealed] of Object.entries(this.file.read().sets[set] ?? {})) {
      try {
        out[id] = JSON.parse(unseal(sealed)) as StoredIgAccount;
      } catch {
        // Unreadable (e.g. keychain reset): treat as disconnected.
      }
    }
    return out;
  }

  private write(set: string, accounts: Record<string, StoredIgAccount>): void {
    const sets = { ...this.file.read().sets };
    sets[set] = Object.fromEntries(Object.entries(accounts).map(([id, a]) => [id, seal(JSON.stringify(a))]));
    this.file.write({ sets });
  }

  list(set: string): StoredIgAccount[] {
    return Object.values(this.read(set));
  }

  get(set: string, id: string): StoredIgAccount | null {
    return this.read(set)[id] ?? null;
  }

  put(set: string, account: StoredIgAccount): void {
    const all = this.read(set);
    all[account.id] = account;
    this.write(set, all);
  }

  remove(set: string, id: string): void {
    const all = this.read(set);
    delete all[id];
    this.write(set, all);
  }
}
