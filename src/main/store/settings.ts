import { homedir } from "node:os";
import { join } from "node:path";
import type { Appearance, SettingsUpdate, SettingsView } from "@shared/contract";
import { JsonFile } from "./jsonFile";
import { seal, unseal } from "./secrets";

interface StoredSettings {
  clientKey: string;
  clientSecretSealed: string;
  directPostEnabled: boolean;
  oauthPort: number;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKeySealed: string;
  r2Bucket: string;
  r2PublicBaseUrl: string;
  r2KeyPrefix: string;
  carouselFolder: string;
  appearance: Appearance;
  igAppId: string;
  igAppSecretSealed: string;
  igRedirectUri: string;
}

/** Plain settings with secrets decrypted — main process only. */
export interface Settings {
  clientKey: string;
  clientSecret: string;
  directPostEnabled: boolean;
  oauthPort: number;
  redirectUri: string;
  r2: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicBaseUrl: string;
    keyPrefix: string;
  };
  carouselFolder: string;
  appearance: Appearance;
  instagram: {
    appId: string;
    appSecret: string;
    redirectUri: string;
  };
  mockMode: boolean;
}

/**
 * Instagram Login only redirects to https URLs. The login runs in an app window
 * that catches the redirect before it loads, so the URL never has to exist.
 */
export const DEFAULT_IG_REDIRECT = "https://localhost/instagram-callback/";

const defaults = (): StoredSettings => ({
  clientKey: "",
  clientSecretSealed: "",
  directPostEnabled: true,
  oauthPort: 53682,
  r2AccountId: "",
  r2AccessKeyId: "",
  r2SecretAccessKeySealed: "",
  r2Bucket: "",
  r2PublicBaseUrl: "",
  r2KeyPrefix: "tiktok/",
  carouselFolder: join(homedir(), "Pictures"),
  appearance: "system",
  igAppId: "",
  igAppSecretSealed: "",
  igRedirectUri: DEFAULT_IG_REDIRECT,
});

/** TikTok's desktop Login Kit only accepts loopback redirects with an explicit port. */
export const redirectUriFor = (port: number) => `http://127.0.0.1:${port}/callback/`;

export class SettingsStore {
  private readonly file = new JsonFile<StoredSettings>("settings.json", defaults);

  get(): Settings {
    const s = this.file.read();
    return {
      clientKey: s.clientKey,
      clientSecret: unseal(s.clientSecretSealed),
      directPostEnabled: s.directPostEnabled,
      oauthPort: s.oauthPort,
      redirectUri: redirectUriFor(s.oauthPort),
      r2: {
        accountId: s.r2AccountId,
        accessKeyId: s.r2AccessKeyId,
        secretAccessKey: unseal(s.r2SecretAccessKeySealed),
        bucket: s.r2Bucket,
        publicBaseUrl: s.r2PublicBaseUrl.replace(/\/+$/, ""),
        keyPrefix: s.r2KeyPrefix,
      },
      carouselFolder: s.carouselFolder,
      appearance: s.appearance,
      instagram: {
        appId: s.igAppId,
        appSecret: unseal(s.igAppSecretSealed),
        redirectUri: s.igRedirectUri,
      },
      mockMode: !s.clientKey,
    };
  }

  view(): SettingsView {
    const s = this.file.read();
    return {
      clientKey: s.clientKey,
      hasClientSecret: Boolean(s.clientSecretSealed),
      directPostEnabled: s.directPostEnabled,
      oauthPort: s.oauthPort,
      redirectUri: redirectUriFor(s.oauthPort),
      r2AccountId: s.r2AccountId,
      r2AccessKeyId: s.r2AccessKeyId,
      hasR2SecretAccessKey: Boolean(s.r2SecretAccessKeySealed),
      r2Bucket: s.r2Bucket,
      r2PublicBaseUrl: s.r2PublicBaseUrl,
      r2KeyPrefix: s.r2KeyPrefix,
      carouselFolder: s.carouselFolder,
      appearance: s.appearance,
      igAppId: s.igAppId,
      hasIgAppSecret: Boolean(s.igAppSecretSealed),
      igRedirectUri: s.igRedirectUri,
      mockMode: !s.clientKey,
    };
  }

  update(u: SettingsUpdate): SettingsView {
    const s = this.file.read();
    const trim = (v: string | undefined, current: string) => (v === undefined ? current : v.trim());
    const next: StoredSettings = {
      clientKey: trim(u.clientKey, s.clientKey),
      clientSecretSealed: u.clientSecret ? seal(u.clientSecret.trim()) : s.clientSecretSealed,
      directPostEnabled: u.directPostEnabled ?? s.directPostEnabled,
      oauthPort: u.oauthPort && u.oauthPort > 1023 && u.oauthPort < 65536 ? u.oauthPort : s.oauthPort,
      r2AccountId: trim(u.r2AccountId, s.r2AccountId),
      r2AccessKeyId: trim(u.r2AccessKeyId, s.r2AccessKeyId),
      r2SecretAccessKeySealed: u.r2SecretAccessKey ? seal(u.r2SecretAccessKey.trim()) : s.r2SecretAccessKeySealed,
      r2Bucket: trim(u.r2Bucket, s.r2Bucket),
      r2PublicBaseUrl: trim(u.r2PublicBaseUrl, s.r2PublicBaseUrl),
      r2KeyPrefix: normalizePrefix(trim(u.r2KeyPrefix, s.r2KeyPrefix)),
      carouselFolder: trim(u.carouselFolder, s.carouselFolder),
      appearance: u.appearance && ["system", "light", "dark"].includes(u.appearance) ? u.appearance : s.appearance,
      igAppId: trim(u.igAppId, s.igAppId),
      igAppSecretSealed: u.igAppSecret ? seal(u.igAppSecret.trim()) : s.igAppSecretSealed,
      igRedirectUri: normalizeIgRedirect(trim(u.igRedirectUri, s.igRedirectUri)),
    };
    this.file.write(next);
    return this.view();
  }
}

function normalizePrefix(prefix: string): string {
  const p = prefix.replace(/^\/+/, "");
  return p && !p.endsWith("/") ? `${p}/` : p;
}

function normalizeIgRedirect(uri: string): string {
  if (!uri) return DEFAULT_IG_REDIRECT;
  if (!/^https:\/\/[^/]+/.test(uri)) throw new Error("The Instagram redirect URI must start with https://");
  return uri;
}
