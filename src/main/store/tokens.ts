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

interface StoredTokens {
  sealed: string;
  /** Which TikTok app (client key, or "mock") these tokens belong to. */
  clientKey: string;
}

/** The connected account's OAuth tokens, encrypted at rest. */
export class TokenStore {
  private readonly file = new JsonFile<StoredTokens>("tokens.json", () => ({ sealed: "", clientKey: "" }));

  get(clientKey: string): Tokens | null {
    const s = this.file.read();
    if (!s.sealed || s.clientKey !== clientKey) return null;
    try {
      return JSON.parse(unseal(s.sealed)) as Tokens;
    } catch {
      return null;
    }
  }

  set(clientKey: string, tokens: Tokens): void {
    this.file.write({ sealed: seal(JSON.stringify(tokens)), clientKey });
  }

  clear(): void {
    this.file.write({ sealed: "", clientKey: "" });
  }
}
