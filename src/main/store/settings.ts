import { homedir } from "node:os";
import { join } from "node:path";
import type { SettingsUpdate, SettingsView } from "@shared/contract";
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
  mockMode: boolean;
}

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
  carouselFolder: join(homedir(), "Documents/Github/tubelingo-carousel/out"),
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
    };
    this.file.write(next);
    return this.view();
  }
}

function normalizePrefix(prefix: string): string {
  const p = prefix.replace(/^\/+/, "");
  return p && !p.endsWith("/") ? `${p}/` : p;
}
