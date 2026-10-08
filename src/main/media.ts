import { net, protocol } from "electron";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LocalFile } from "@shared/contract";

/**
 * The renderer can't load file:// from its origin, so local media is served
 * over media://. Only files the user picked or dropped are served.
 */
const allowed = new Set<string>();

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

export function handleMediaProtocol(): void {
  protocol.handle("media", (req) => {
    const path = decodeURIComponent(new URL(req.url).searchParams.get("p") ?? "");
    if (!allowed.has(path)) return new Response("Not found", { status: 404 });
    // Forward Range so <video> can seek.
    return net.fetch(pathToFileURL(path).toString(), { headers: req.headers });
  });
}

export function toLocalFile(path: string): LocalFile {
  const abs = resolve(path);
  allowed.add(abs);
  return {
    path: abs,
    name: basename(abs),
    size: statSync(abs).size,
    url: `media://file/?p=${encodeURIComponent(abs)}`,
  };
}

export function isAllowed(path: string): boolean {
  return allowed.has(resolve(path));
}
