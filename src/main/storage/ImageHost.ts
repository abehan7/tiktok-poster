import { AwsClient } from "aws4fetch";
import type { TestResult } from "@shared/contract";
import type { Settings } from "../store/settings";

/** Somewhere TikTok can pull carousel images from (a verified HTTPS domain). */
export interface ImageHost {
  /** Uploads and returns the public URL. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  test(): Promise<TestResult>;
}

export function createImageHost(settings: Settings): ImageHost {
  return settings.mockMode ? new MockImageHost() : new R2ImageHost(settings.r2);
}

/** Cloudflare R2 through its S3 API; served publicly from a custom domain. */
export class R2ImageHost implements ImageHost {
  constructor(private readonly r2: Settings["r2"]) {}

  private missing(): string[] {
    const r = this.r2;
    return [
      !r.accountId && "account ID",
      !r.accessKeyId && "access key ID",
      !r.secretAccessKey && "secret access key",
      !r.bucket && "bucket",
      !r.publicBaseUrl && "public base URL",
    ].filter(Boolean) as string[];
  }

  private client() {
    return new AwsClient({
      accessKeyId: this.r2.accessKeyId,
      secretAccessKey: this.r2.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    const missing = this.missing();
    if (missing.length) throw new Error(`R2 isn't set up (missing ${missing.join(", ")}). See Settings.`);
    if (!this.r2.publicBaseUrl.startsWith("https://")) {
      throw new Error("The R2 public base URL must be https:// — TikTok rejects anything else.");
    }
    const fullKey = `${this.r2.keyPrefix}${key}`;
    const endpoint = `https://${this.r2.accountId}.r2.cloudflarestorage.com/${this.r2.bucket}/${fullKey
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const res = await this.client().fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`R2 upload failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    return `${this.r2.publicBaseUrl}/${fullKey}`;
  }

  /** Uploads a small object and checks it's reachable the way TikTok needs (200, no redirect). */
  async test(): Promise<TestResult> {
    try {
      const url = await this.put(`_healthcheck/${Date.now()}.txt`, Buffer.from("ok"), "text/plain");
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, message: `Uploaded, but ${url} redirects (HTTP ${res.status}). TikTok treats redirects as invalid.` };
      }
      if (!res.ok) {
        return { ok: false, message: `Uploaded, but ${url} returned HTTP ${res.status}. Is the custom domain connected to the bucket?` };
      }
      return { ok: true, message: `Upload and public read work: ${url}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Mock mode: pretends to upload. */
export class MockImageHost implements ImageHost {
  async put(key: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 250));
    return `https://media.example.com/tiktok/${key}`;
  }

  async test(): Promise<TestResult> {
    return { ok: true, message: "Mock mode: nothing is uploaded until a TikTok client key is set." };
  }
}
