import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { controlSocketPath, USER_DATA_ENV, type ControlApi, type ControlEvent, type ControlReply } from "@shared/control";

type Method = keyof ControlApi;
type Result<M extends Method> = Awaited<ReturnType<ControlApi[M]>>;

const APP_NAME = "TikTok Poster";
const LAUNCH_WAIT_MS = 20_000;

export function userDataDir(): string {
  const custom = process.env[USER_DATA_ENV];
  return custom ? resolve(custom) : join(homedir(), "Library", "Application Support", APP_NAME);
}

export class AppNotRunning extends Error {}

/** One connection to the app's control socket. Requests are answered in any order, matched by id. */
export class Client {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private readonly listeners = new Set<(e: ControlEvent) => void>();
  private subscribed = false;

  private constructor(private readonly sock: Socket) {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buf += chunk;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const msg = JSON.parse(buf.slice(0, i)) as ControlReply | ControlEvent;
        buf = buf.slice(i + 1);
        if ("event" in msg) for (const l of this.listeners) l(msg);
        else this.settle(msg);
      }
    });
    sock.on("close", () => {
      for (const p of this.pending.values()) p.reject(new Error(`${APP_NAME} quit before answering.`));
      this.pending.clear();
    });
  }

  /** Connects to the running app; with `launch`, starts the installed app first if it isn't running. */
  static async connect({ launch = true } = {}): Promise<Client> {
    const path = controlSocketPath(userDataDir());
    try {
      return new Client(await open(path));
    } catch {
      if (!launch || !launchApp()) {
        throw new AppNotRunning(
          `${APP_NAME} isn't running. Open the app (or \`npm run dev\` in a checkout) and try again.` +
            (process.env[USER_DATA_ENV] ? `\n(Looking for ${path} because ${USER_DATA_ENV} is set.)` : ""),
        );
      }
    }
    process.stderr.write(`Starting ${APP_NAME}…\n`);
    const until = Date.now() + LAUNCH_WAIT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        return new Client(await open(path));
      } catch {
        // not listening yet
      }
    }
    throw new AppNotRunning(
      `${APP_NAME} isn't answering. If it's already open, it may be a version without the command line: update or restart it.`,
    );
  }

  call<M extends Method>(method: M, ...params: Parameters<ControlApi[M]>): Promise<Result<M>> {
    return this.send(method, params) as Promise<Result<M>>;
  }

  /** Receives progress/history events from now on. */
  async onEvent(listener: (e: ControlEvent) => void): Promise<() => void> {
    this.listeners.add(listener);
    if (!this.subscribed) {
      this.subscribed = true;
      await this.send("subscribe", []);
    }
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.sock.end();
  }

  private send(method: string, params: unknown[]): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private settle(reply: ControlReply) {
    const p = this.pending.get(reply.id);
    if (!p) return;
    this.pending.delete(reply.id);
    if (reply.ok) p.resolve(reply.value);
    else p.reject(new Error(reply.error));
  }
}

function open(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path);
    sock.once("connect", () => {
      sock.off("error", reject);
      resolve(sock);
    });
    sock.once("error", reject);
  });
}

/** Opens the installed app in the background. Only for the default data folder: a custom one means a dev copy. */
function launchApp(): boolean {
  if (process.platform !== "darwin" || process.env[USER_DATA_ENV]) return false;
  const installed = [join("/Applications", `${APP_NAME}.app`), join(homedir(), "Applications", `${APP_NAME}.app`)].some(existsSync);
  return installed && spawnSync("open", ["-g", "-a", APP_NAME]).status === 0;
}
