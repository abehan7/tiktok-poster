import { app } from "electron";
import { chmodSync, existsSync, statSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { controlSocketPath, GUI_ONLY, type ControlEvent, type ControlExtras, type ControlReply, type ControlRequest } from "@shared/control";
import type { Handlers } from "../ipc";
import { toLocalFile } from "../media";

type Fn = (...args: unknown[]) => unknown;

/**
 * Serves the CLI over userData/control.sock (see @shared/control). The socket is created owner-only, so
 * only the signed-in user can drive the app; posts go through the same handlers and checks as the UI.
 */
export class ControlServer {
  private server: Server | null = null;
  private readonly subscribers = new Set<Socket>();
  private methods = new Map<string, Fn>();

  start(handlers: Handlers, extras: ControlExtras): void {
    const gui = new Set<string>(GUI_ONLY);
    this.methods = new Map(
      [...Object.entries(handlers).filter(([name]) => !gui.has(name)), ...Object.entries(extras)] as Array<[string, Fn]>,
    );

    const path = controlSocketPath(app.getPath("userData"));
    // Left over from a crash, or held by another copy of the app: the newest one takes over.
    if (existsSync(path)) unlinkSync(path);
    this.server = createServer((sock) => this.accept(sock));
    this.server.on("error", (err) => console.error("[control]", err));
    const umask = process.umask(0o177);
    try {
      this.server.listen(path, () => chmodSync(path, 0o600));
    } finally {
      process.umask(umask);
    }
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  broadcast(event: ControlEvent["event"], data: unknown): void {
    if (!this.subscribers.size) return;
    const line = `${JSON.stringify({ event, data } satisfies ControlEvent)}\n`;
    for (const sock of this.subscribers) if (!sock.destroyed) sock.write(line);
  }

  private accept(sock: Socket) {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buf += chunk;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) void this.handle(sock, line);
      }
    });
    const drop = () => this.subscribers.delete(sock);
    sock.on("close", drop);
    sock.on("error", drop);
  }

  private async handle(sock: Socket, line: string) {
    let reply: ControlReply;
    let id = 0;
    try {
      const req = JSON.parse(line) as ControlRequest;
      id = req.id;
      reply = { id, ok: true, value: (await this.call(sock, req.method, req.params ?? [])) ?? null };
    } catch (err) {
      reply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!sock.destroyed) sock.write(`${JSON.stringify(reply)}\n`);
  }

  private call(sock: Socket, method: string, params: unknown[]) {
    if (method === "subscribe") {
      this.subscribers.add(sock);
      return true;
    }
    const fn = this.methods.get(method);
    if (!fn) throw new Error(`Unknown method: ${method}`);
    allowFiles(params[0]);
    return fn(...params);
  }
}

/** The CLI names files by path instead of picking them in a dialog; register them so the usual checks pass. */
function allowFiles(input: unknown) {
  if (!input || typeof input !== "object") return;
  const { filePath, filePaths } = input as { filePath?: unknown; filePaths?: unknown };
  const paths = [filePath, ...(Array.isArray(filePaths) ? filePaths : [])].filter((p): p is string => typeof p === "string");
  for (const p of paths) {
    if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`No such file: ${p}`);
    toLocalFile(p);
  }
}
