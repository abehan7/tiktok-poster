import { shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function createCodeVerifier(length = 64): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => UNRESERVED[b % UNRESERVED.length]).join("");
}

/**
 * TikTok's desktop Login Kit wants the S256 challenge as the *hex* SHA-256 of
 * the verifier — not base64url like RFC 7636.
 */
export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("hex");
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px -apple-system,system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#111;color:#eee">` +
  `<div style="text-align:center"><h2>${title}</h2><p style="color:#aaa">${body}</p></div></body>`;

/** The login currently waiting for its redirect, if any. Only one can hold the port. */
let pending: { cancel(reason: Error): Promise<void> } | null = null;

/** Abandons the in-flight login (e.g. TikTok showed an error page and never redirected). */
export async function cancelAuthorization(): Promise<void> {
  await pending?.cancel(new Error("Login cancelled."));
}

/**
 * Opens the TikTok consent page in the default browser and waits for the
 * redirect on a one-shot loopback server. Resolves with the authorization code.
 * Starting a new login cancels a previous one that is still waiting.
 */
export async function waitForAuthorizationCode(opts: {
  authorizeUrl: (state: string) => string;
  port: number;
  timeoutMs?: number;
}): Promise<string> {
  await cancelAuthorization();
  const state = randomBytes(16).toString("hex");

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${opts.port}`);
      if (!url.pathname.startsWith("/callback")) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

      if (url.searchParams.get("state") !== state) {
        res.end(page("Login failed", "State mismatch. Start the login again from the app."));
        return void finish(new Error("OAuth state mismatch"));
      }
      if (error || !code) {
        const description = url.searchParams.get("error_description") ?? error ?? "No code returned";
        res.end(page("Login cancelled", description));
        return void finish(new Error(`TikTok login failed: ${description}`));
      }
      res.end(page("Connected to TikTok", "You can close this tab and go back to TikTok Poster."));
      void finish(null, code);
    });

    const timer = setTimeout(
      () => void finish(new Error("Timed out waiting for TikTok login.")),
      opts.timeoutMs ?? 5 * 60_000,
    );

    let done = false;
    /** Settles the login and resolves once the port is released. */
    function finish(err: Error | null, code?: string): Promise<void> {
      if (done) return Promise.resolve();
      done = true;
      clearTimeout(timer);
      if (pending === self) pending = null;
      if (err) reject(err);
      else resolve(code!);
      return new Promise((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
    }

    const self = { cancel: (reason: Error) => finish(reason) };
    pending = self;

    server.on("error", (err: NodeJS.ErrnoException) =>
      void finish(
        err.code === "EADDRINUSE"
          ? new Error(`Port ${opts.port} is busy. Change the OAuth port in Settings (and in the TikTok portal).`)
          : err,
      ),
    );
    server.listen(opts.port, "127.0.0.1", () => {
      void shell.openExternal(opts.authorizeUrl(state));
    });
  });
}
