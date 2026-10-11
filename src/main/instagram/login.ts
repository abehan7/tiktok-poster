import { BrowserWindow } from "electron";
import { randomBytes } from "node:crypto";

/** Instagram serves a stripped-down page (or refuses) to user agents that say "Electron". */
const CHROME_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

let open: BrowserWindow | null = null;

/**
 * Shows Instagram Login in an app window and resolves with the authorization
 * code. Instagram only redirects to https URLs, so instead of a loopback
 * server the window watches its own navigations and stops at the redirect URI.
 * The login cookie is kept (persist: partition), so reconnecting is one click.
 */
export function waitForInstagramCode(opts: {
  authorizeUrl: (state: string) => string;
  redirectUri: string;
  parent: BrowserWindow | null;
}): Promise<string> {
  open?.close();
  const state = randomBytes(16).toString("hex");

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 480,
      height: 760,
      parent: opts.parent ?? undefined,
      title: "Connect Instagram",
      autoHideMenuBar: true,
      webPreferences: { partition: "persist:instagram-login", sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    open = win;
    let done = false;

    const finish = (err: Error | null, code?: string) => {
      if (done) return;
      done = true;
      if (open === win) open = null;
      if (!win.isDestroyed()) win.close();
      if (err) reject(err);
      else resolve(code!);
    };

    /** True (and settles) when `url` is the redirect back to the app. */
    const check = (url: string): boolean => {
      if (!url.startsWith(opts.redirectUri)) return false;
      const u = new URL(url);
      if (u.searchParams.get("state") !== state) {
        finish(new Error("Instagram login failed: state mismatch. Try again."));
        return true;
      }
      // Instagram appends "#_" to the redirect; URL keeps that in the hash, not in the code.
      const code = u.searchParams.get("code");
      if (code) finish(null, code);
      else if (u.searchParams.get("error_reason") === "user_denied") finish(new Error("Login cancelled."));
      else finish(new Error(`Instagram login failed: ${u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "no code returned"}`));
      return true;
    };

    const wc = win.webContents;
    wc.setUserAgent(CHROME_UA);
    wc.on("will-redirect", (e) => check(e.url) && e.preventDefault());
    wc.on("will-navigate", (e) => check(e.url) && e.preventDefault());
    // Fallback if a redirect slipped past the events above (the page itself fails to load).
    wc.on("did-fail-load", (_e, _code, _desc, url) => void check(url));
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("closed", () => finish(new Error("Login cancelled.")));

    void win.loadURL(opts.authorizeUrl(state)).catch(() => undefined);
  });
}

/** Closes a login window that is still open. */
export function cancelInstagramLogin(): void {
  open?.close();
}
