import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { ParseArgsConfig } from "node:util";
import type {
  Account,
  HistoryEntry,
  IgAccount,
  Platform,
  PostMode,
  PrivacyLevel,
  Progress,
  SettingsUpdate,
  SettingsView,
  View,
} from "@shared/contract";
import { Client, userDataDir } from "./client";
import {
  c,
  ENTRY_HEAD,
  entryDetail,
  entryRows,
  fmtRelative,
  fmtTime,
  platformOf,
  PRIVACY,
  privacyName,
  shortId,
  stateLabel,
  stateOf,
  STATES,
  table,
  type State,
} from "./format";
import { parseWhen, WHEN_HELP } from "./time";

export type Options = NonNullable<ParseArgsConfig["options"]>;
type Values = Record<string, string | boolean | Array<string | boolean> | undefined>;

export interface Ctx {
  values: Values;
  positionals: string[];
  json: boolean;
  client(): Promise<Client>;
}

export interface Command {
  usage: string;
  summary: string;
  /** Extra help shown by `<command> --help`. */
  details?: string;
  options?: Options;
  run(ctx: Ctx): Promise<number | void>;
}

/** Bad arguments: printed with the command's usage, exit code 2. */
export class UsageError extends Error {}

const TERMINAL = new Set(["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED", "CANCELLED"]);
const VIEWS: View[] = ["dashboard", "carousel", "video", "calendar", "history", "settings"];

// ── helpers ──────────────────────────────────────────────────────────────────

function print(ctx: Ctx, value: unknown, human: () => string) {
  console.log(ctx.json ? JSON.stringify(value, null, 2) : human());
}

const str = (v: Values[string]) => (typeof v === "string" ? v : undefined);
/** Repeatable and/or comma-separated option values. */
const list = (v: Values[string]) => (Array.isArray(v) ? v : [v]).flatMap((s) => (typeof s === "string" ? s.split(",") : []));

function need(ctx: Ctx, n: number, what: string): string[] {
  if (ctx.positionals.length < n) throw new UsageError(`Missing ${what}.`);
  return ctx.positionals;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** "-" reads stdin. */
async function valueOrStdin(v: string): Promise<string> {
  return v === "-" ? (await readStdin()).trim() : v;
}

async function confirm(ctx: Ctx, question: string): Promise<boolean> {
  if (ctx.values.yes) return true;
  if (!process.stdin.isTTY) throw new UsageError(`${question} Pass --yes to confirm.`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** Full ID or any unique prefix of one. */
async function resolveEntries(client: Client, ids: string[]): Promise<HistoryEntry[]> {
  const all = await client.call("listHistory");
  return ids.map((id) => {
    const q = id.toLowerCase();
    const hits = all.filter((e) => e.id.toLowerCase().startsWith(q));
    if (hits.length === 1) return hits[0];
    if (!hits.length) throw new Error(`No post with ID ${id}.`);
    throw new Error(`ID ${id} matches ${hits.length} posts; use more characters.`);
  });
}

// ── accounts ─────────────────────────────────────────────────────────────────

interface AnyAccount {
  platform: Platform;
  id: string;
  /** @handle, or the display name when TikTok didn't give a handle. */
  name: string;
  tiktok?: Account;
  instagram?: IgAccount;
}

async function allAccounts(client: Client): Promise<AnyAccount[]> {
  const [tt, ig] = await Promise.all([client.call("listAccounts"), client.call("listIgAccounts")]);
  return [
    ...tt.map((a) => ({ platform: "tiktok" as const, id: a.openId, name: a.username ? `@${a.username}` : a.displayName, tiktok: a })),
    ...ig.map((a) => ({ platform: "instagram" as const, id: a.id, name: `@${a.username}`, instagram: a })),
  ];
}

const norm = (s: string) => s.toLowerCase().replace(/^@/, "");

/** @handle, display name or ID, on one platform or either. */
function pickAccount(accounts: AnyAccount[], query: string, platform?: Platform): AnyAccount {
  const q = norm(query);
  const pool = accounts.filter((a) => !platform || a.platform === platform);
  const hits = pool.filter((a) =>
    [a.id, a.name, a.tiktok?.displayName, a.instagram?.displayName, a.instagram?.username].some((v) => v && norm(v) === q),
  );
  if (hits.length === 1) return hits[0];
  const where = platform === "tiktok" ? "TikTok " : platform === "instagram" ? "Instagram " : "";
  const known = pool.map((a) => `${a.name} (${a.platform})`).join(", ") || "none";
  if (!hits.length) throw new Error(`No ${where}account matches "${query}". Connected: ${known}.`);
  throw new Error(`"${query}" matches ${hits.length} accounts; use the ID, or --platform.`);
}

function accountRows(accounts: AnyAccount[]): string[][] {
  return accounts.map((a) => {
    const problem = a.tiktok?.loginProblem ?? a.instagram?.loginProblem;
    const status = problem
      ? c.red(`reconnect: ${problem}`)
      : a.instagram
        ? c.green("ok") + c.dim(` · token to ${fmtTime(a.instagram.expiresAt).replace(/ \d\d:\d\d$/, "")}`)
        : a.tiktok!.scopes.includes("video.publish")
          ? c.green("ok") + c.dim(" · draft + direct")
          : c.green("ok") + c.dim(" · draft only");
    return [a.platform, a.name, a.tiktok?.displayName ?? a.instagram?.displayName ?? "", c.dim(a.id), a.tiktok?.note ?? a.instagram?.note ?? "", status];
  });
}

const accounts: Command = {
  usage: "accounts [connect <tiktok|instagram> | add-token [token|-] | info <account> | note <account> <text> | remove <account>]",
  summary: "List, connect and manage TikTok and Instagram accounts",
  details: `Subcommands:
  (none)                         List connected accounts
  connect tiktok                 Sign in with TikTok in your browser (adds whichever account signs in)
  connect instagram              Instagram Login in an app window
  add-token [token|-]            Add an Instagram account from a long-lived token ("-" or no value reads stdin)
  info <account>                 What TikTok allows this account: privacy options, max video length, interactions
  note <account> <text…>         Set the reminder note (e.g. which Google login it uses); "" clears it
  remove <account>               Disconnect (revokes the TikTok token)`,
  options: { platform: { type: "string" } },
  async run(ctx) {
    const [sub, ...rest] = ctx.positionals;
    const client = await ctx.client();
    const platform = str(ctx.values.platform) as Platform | undefined;
    if (platform && platform !== "tiktok" && platform !== "instagram") throw new UsageError("--platform is tiktok or instagram.");

    if (!sub || sub === "list" || sub === "ls") {
      const all = (await allAccounts(client)).filter((a) => !platform || a.platform === platform);
      return print(ctx, all.map((a) => ({ platform: a.platform, ...(a.tiktok ?? a.instagram) })), () =>
        all.length
          ? table(["PLATFORM", "ACCOUNT", "NAME", "ID", "NOTE", "LOGIN"], accountRows(all))
          : "No accounts connected. Run `tiktok-poster accounts connect tiktok`.",
      );
    }

    if (sub === "connect") {
      const target = rest[0] ?? platform;
      if (target === "tiktok") {
        if (!ctx.json) process.stderr.write("Sign in to TikTok in your browser… (Ctrl-C cancels)\n");
        const cancel = () => void client.call("cancelConnect").finally(() => process.exit(130));
        process.once("SIGINT", cancel);
        const a = await client.call("connect");
        process.off("SIGINT", cancel);
        return print(ctx, a, () => `${c.green("✓")} Connected ${a.username ? `@${a.username}` : a.displayName} ${c.dim(a.openId)}`);
      }
      if (target === "instagram") {
        if (!ctx.json) process.stderr.write("Log in to Instagram in the app window…\n");
        const a = await client.call("connectInstagram");
        return print(ctx, a, () => `${c.green("✓")} Connected @${a.username} ${c.dim(a.id)}`);
      }
      throw new UsageError("accounts connect tiktok | instagram");
    }

    if (sub === "add-token") {
      const token = await valueOrStdin(rest[0] ?? "-");
      if (!token) throw new UsageError("No token given.");
      const a = await client.call("addInstagramToken", token);
      return print(ctx, a, () => `${c.green("✓")} Added Instagram @${a.username} ${c.dim(a.id)}`);
    }

    if (sub === "info") {
      const a = pickAccount(await allAccounts(client), need(ctx, 2, "account")[1], "tiktok");
      const info = await client.call("getCreatorInfo", a.id);
      return print(ctx, info, () =>
        [
          `${c.bold(`@${info.username}`)} ${info.nickname}`,
          `${c.dim("Privacy options")}  ${info.privacyLevelOptions.map(privacyName).join(", ")}`,
          `${c.dim("Max video")}        ${info.maxVideoPostDurationSec}s`,
          `${c.dim("Comments")}         ${info.commentDisabled ? "off in the TikTok app" : "allowed"}`,
          `${c.dim("Duet / Stitch")}    ${info.duetDisabled ? "duet off" : "duet ok"}, ${info.stitchDisabled ? "stitch off" : "stitch ok"}`,
        ].join("\n"),
      );
    }

    if (sub === "note") {
      need(ctx, 3, "account and note text");
      const a = pickAccount(await allAccounts(client), rest[0], platform);
      const note = rest.slice(1).join(" ");
      if (a.platform === "tiktok") await client.call("setAccountNote", a.id, note);
      else await client.call("setIgAccountNote", a.id, note);
      return print(ctx, { id: a.id, note }, () => `${c.green("✓")} ${a.name}: ${note ? `"${note}"` : "note cleared"}`);
    }

    if (sub === "remove" || sub === "disconnect") {
      const a = pickAccount(await allAccounts(client), need(ctx, 2, "account")[1], platform);
      if (!(await confirm(ctx, `Disconnect ${a.platform} account ${a.name}?`))) return 1;
      if (a.platform === "tiktok") await client.call("disconnect", a.id);
      else await client.call("disconnectInstagram", a.id);
      return print(ctx, { removed: a.id }, () => `${c.green("✓")} Disconnected ${a.name}`);
    }

    throw new UsageError(`Unknown subcommand: accounts ${sub}`);
  },
};

// ── posting ──────────────────────────────────────────────────────────────────

const postOptions: Options = {
  tiktok: { type: "string", short: "t", multiple: true },
  instagram: { type: "string", short: "i", multiple: true },
  at: { type: "string" },
  direct: { type: "boolean" },
  privacy: { type: "string" },
  caption: { type: "string", short: "c" },
  "caption-file": { type: "string" },
  title: { type: "string" },
  "ig-caption": { type: "string" },
  cover: { type: "string" },
  "no-comments": { type: "boolean" },
  "no-duet": { type: "boolean" },
  "no-stitch": { type: "boolean" },
  music: { type: "boolean" },
  aigc: { type: "boolean" },
  "no-feed": { type: "boolean" },
  wait: { type: "boolean", short: "w" },
};

const POST_DETAILS = `Where:
  -t, --tiktok <account>      Post to this TikTok account (repeatable). Default: your only TikTok account
  -i, --instagram <account>   Also/instead post to this Instagram account (repeatable). Instagram has no drafts:
                              it's public as soon as it's sent
When:
  --at <when>                 Schedule instead of posting now: ${WHEN_HELP}
                              The app must be running then; your files are copied now
  -w, --wait                  Wait until it's in the TikTok inbox / published (or failed)
TikTok:
  --direct                    Direct post to the profile (default: draft to the TikTok inbox)
  --privacy <who>             Direct posts only, required: public, friends, followers, private
                              (unaudited TikTok apps can only post private)
  --no-comments               Turn comments off
  --aigc                      Add TikTok's AI-generated content label
Text:
  -c, --caption <text>        Caption (video) / description (carousel)
  --caption-file <path>       Read it from a file ("-" = stdin)
  --title <text>              Carousel title, ≤ 90 chars
  --ig-caption <text>         Different caption for Instagram (default: the same)`;

const postVideo: Command = {
  usage: "post video <file> [options]",
  summary: "Post or schedule a video to TikTok and/or Instagram Reels",
  details: `${POST_DETAILS}
Video:
  --cover <time>              Cover frame: seconds ("2.5") or "1500ms" (default: first frame)
  --no-duet, --no-stitch      Turn Duet / Stitch off (TikTok direct posts)
  --no-feed                   Instagram: Reels tab only, not the main feed

Examples:
  tiktok-poster post video clip.mp4
  tiktok-poster post video clip.mp4 -t @mychannel -i @myinsta --at "tomorrow 9:00" -c "caption #tag"
  tiktok-poster post video clip.mp4 --direct --privacy public --wait`,
  options: postOptions,
  run: (ctx) => post(ctx, "video"),
};

const postCarousel: Command = {
  usage: "post carousel <images…|folder> [options]",
  summary: "Post or schedule a photo carousel (TikTok ≤ 35 slides, Instagram ≤ 10)",
  details: `${POST_DETAILS}
Carousel:
  --cover <n>                 TikTok cover slide, 1-based (default 1). Instagram always uses slide 1
  --music                     Let TikTok add music automatically

A single folder argument works like "Load render folder…": numbered images in order, files starting with "_"
skipped, and caption.txt as the description unless you pass one.

Examples:
  tiktok-poster post carousel ./renders/day12 --at 21:00
  tiktok-poster post carousel 1.png 2.png 3.png --title "Three tips" -c "More in bio" -t @mychannel -i @myinsta`,
  options: postOptions,
  run: (ctx) => post(ctx, "carousel"),
};

function parseCoverMs(v: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s)?$/.exec(v.trim());
  if (!m) throw new UsageError(`--cover takes seconds ("2.5") or milliseconds ("2500ms"), not "${v}".`);
  return Math.round(Number(m[1]) * (m[2] === "ms" ? 1 : 1000));
}

interface Sent {
  platform: Platform;
  account: string;
  entry?: HistoryEntry;
  error?: string;
}

async function post(ctx: Ctx, kind: "video" | "carousel"): Promise<number> {
  const v = ctx.values;
  if (!ctx.positionals.length) throw new UsageError(kind === "video" ? "Which video?" : "Which images (or folder)?");
  if (kind === "video" && ctx.positionals.length > 1) throw new UsageError("Post one video at a time.");
  const client = await ctx.client();

  // Files: paths are resolved here, since the app's working directory isn't yours.
  let files = ctx.positionals.map((p) => resolve(p));
  let folderCaption = "";
  for (const f of files) if (!existsSync(f)) throw new Error(`No such file: ${f}`);
  if (kind === "carousel" && files.length === 1 && statSync(files[0]).isDirectory()) {
    const folder = await client.call("readCarouselFolder", files[0]);
    if (!folder.images.length) throw new Error(`No slide images in ${files[0]}.`);
    files = folder.images.map((i) => i.path);
    folderCaption = folder.caption;
  }

  // Destinations.
  const all = await allAccounts(client);
  let tt = list(v.tiktok).map((q) => pickAccount(all, q, "tiktok"));
  const ig = list(v.instagram).map((q) => pickAccount(all, q, "instagram"));
  if (!tt.length && !ig.length) {
    const only = all.filter((a) => a.platform === "tiktok");
    if (only.length !== 1) {
      const known = all.map((a) => `${a.name} (${a.platform})`).join(", ") || "none connected";
      throw new UsageError(`Say where to post with --tiktok <account> and/or --instagram <account>. Accounts: ${known}.`);
    }
    tt = only;
  }

  // Options.
  const at = str(v.at) ? parseWhen(str(v.at)!).toISOString() : null;
  const captionFile = str(v["caption-file"]);
  const fromFile = captionFile && (captionFile === "-" ? await readStdin() : readFileSync(resolve(captionFile), "utf8"));
  const text = str(v.caption) ?? (fromFile ? fromFile.trim() : undefined);
  const caption = text ?? folderCaption;
  const igCaption = str(v["ig-caption"]) ?? caption;
  const mode: PostMode = v.direct ? "DIRECT" : "DRAFT";
  let privacy: PrivacyLevel = "SELF_ONLY"; // ignored for drafts
  if (str(v.privacy)) {
    if (!v.direct) throw new UsageError("--privacy is for direct posts; add --direct.");
    const p = str(v.privacy)!;
    const level = PRIVACY[p.toLowerCase()] ?? Object.values(PRIVACY).find((x) => x === p.toUpperCase());
    if (!level) throw new UsageError("--privacy is one of: public, friends, followers, private.");
    privacy = level;
  } else if (v.direct && tt.length) {
    throw new UsageError("Direct posts need --privacy (public, friends, followers or private); TikTok has no default.");
  }
  if (kind === "video" && (v.title || v.music)) throw new UsageError("--title and --music are for carousels.");
  if (kind === "carousel" && (v["no-duet"] || v["no-stitch"] || v["no-feed"])) throw new UsageError("--no-duet, --no-stitch and --no-feed are for videos.");
  const coverMs = kind === "video" && str(v.cover) ? parseCoverMs(str(v.cover)!) : 0;
  const coverIndex = kind === "carousel" && str(v.cover) ? Number(str(v.cover)) - 1 : 0;
  if (!Number.isInteger(coverIndex) || coverIndex < 0 || coverIndex >= files.length) {
    throw new UsageError(`--cover is a slide number from 1 to ${files.length}.`);
  }

  // Direct posts: check the account can, and allows that audience, before anything is sent.
  if (mode === "DIRECT") {
    for (const a of tt) {
      if (!a.tiktok!.scopes.includes("video.publish")) {
        throw new Error(`${a.name} can't direct post (no video.publish permission). Post a draft, or turn on Direct Post and reconnect.`);
      }
      const info = await client.call("getCreatorInfo", a.id);
      if (!info.privacyLevelOptions.includes(privacy)) {
        throw new Error(`${a.name} can't post "${privacyName(privacy)}". It allows: ${info.privacyLevelOptions.map(privacyName).join(", ")}.`);
      }
    }
  }

  const jobs: Array<{ platform: Platform; account: AnyAccount; send(): Promise<HistoryEntry> }> = [
    ...tt.map((a) => ({
      platform: "tiktok" as const,
      account: a,
      send: () => {
        const common = { openId: a.id, mode, privacyLevel: privacy, disableComment: Boolean(v["no-comments"]), isAigc: Boolean(v.aigc) };
        if (kind === "video") {
          const input = {
            ...common,
            filePath: files[0],
            title: caption,
            disableDuet: Boolean(v["no-duet"]),
            disableStitch: Boolean(v["no-stitch"]),
            coverTimestampMs: coverMs,
          };
          return at ? client.call("scheduleVideo", input, at) : client.call("postVideo", input);
        }
        const input = { ...common, filePaths: files, title: str(v.title) ?? "", description: caption, coverIndex, autoAddMusic: Boolean(v.music) };
        return at ? client.call("schedulePhotos", input, at) : client.call("postPhotos", input);
      },
    })),
    ...ig.map((a) => ({
      platform: "instagram" as const,
      account: a,
      send: () => {
        if (kind === "video") {
          const input = { igUserId: a.id, filePath: files[0], caption: igCaption, coverTimestampMs: coverMs, shareToFeed: !v["no-feed"] };
          return at ? client.call("scheduleIgVideo", input, at) : client.call("postIgVideo", input);
        }
        const input = { igUserId: a.id, filePaths: files, caption: igCaption };
        return at ? client.call("scheduleIgPhotos", input, at) : client.call("postIgPhotos", input);
      },
    })),
  ];

  const progress = await showProgress(ctx, client);
  const results: Sent[] = [];
  for (const job of jobs) {
    const dest = `${job.platform === "tiktok" ? "TikTok" : "Instagram"} ${job.account.name}`;
    try {
      const entry = await job.send();
      progress.clear();
      results.push({ platform: job.platform, account: job.account.id, entry });
      if (!ctx.json) {
        const what = at ? `scheduled for ${fmtTime(entry.scheduledAt)} ${c.dim(`(${fmtRelative(entry.scheduledAt!)})`)}` : "sent";
        console.log(`${c.green("✓")} ${dest}: ${what}  ${c.dim(`id ${shortId(entry.id)}`)}`);
      }
    } catch (err) {
      progress.clear();
      const error = err instanceof Error ? err.message : String(err);
      results.push({ platform: job.platform, account: job.account.id, error });
      if (!ctx.json) console.error(`${c.red("✗")} ${dest}: ${error}`);
    }
  }
  progress.stop();

  let failed = results.some((r) => r.error);
  const sent = results.flatMap((r) => (r.entry ? [r.entry] : []));
  if (v.wait && sent.length) {
    const final = await waitFor(ctx, client, sent.map((e) => e.id));
    for (const r of results) r.entry = final.find((e) => e.id === r.entry?.id) ?? r.entry;
    failed ||= final.some((e) => e.status === "FAILED" || e.status === "CANCELLED");
  }
  if (ctx.json) console.log(JSON.stringify(results, null, 2));
  else if (!v.wait && !at && sent.length) console.error(c.dim("Still processing in the app; check with `tiktok-poster list` or `tiktok-poster wait <id>`."));
  return failed ? 1 : 0;
}

/** Upload progress on stderr while a post is being sent (TTY only). */
async function showProgress(ctx: Ctx, client: Client, ids?: Set<string>) {
  const tty = process.stderr.isTTY && !ctx.json;
  const started = Date.now();
  const mine = ids ?? new Set<string>();
  let shown = false;
  const clear = () => {
    if (shown) process.stderr.write("\r\x1b[K");
    shown = false;
  };
  const off = tty
    ? await client.onEvent((ev) => {
        if (ev.event === "history") {
          const e = ev.data as HistoryEntry;
          // Entries this command just created (other posts may be going out at the same time).
          if (!ids && Date.parse(e.createdAt) >= started - 1000) mine.add(e.id);
          return;
        }
        const p = ev.data as Progress;
        if (!mine.has(p.entryId)) return;
        const pct = p.fraction === null ? "" : ` ${Math.round(p.fraction * 100)}%`;
        process.stderr.write(`\r\x1b[K${c.dim(`  ${p.stage}${pct}`)}`);
        shown = true;
      })
    : () => undefined;
  return { clear, stop: () => (clear(), off()) };
}

/** Resolves once every entry is in the inbox / published / failed / cancelled. */
async function waitFor(ctx: Ctx, client: Client, ids: string[], timeoutMs?: number): Promise<HistoryEntry[]> {
  const latest = new Map<string, HistoryEntry>();
  const progress = await showProgress(ctx, client, new Set(ids));
  if (!ctx.json) process.stderr.write(c.dim(`Waiting for ${ids.length === 1 ? shortId(ids[0]) : `${ids.length} posts`}… (Ctrl-C stops waiting; the post carries on)\n`));
  return new Promise<HistoryEntry[]>((resolvePromise, reject) => {
    let finished = false;
    let off = () => {};
    const timer = timeoutMs ? setTimeout(() => finish(new Error("Timed out waiting.")), timeoutMs) : null;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      off();
      progress.stop();
      if (err) reject(err);
      else resolvePromise(ids.map((id) => latest.get(id)!));
    };
    const see = (e: HistoryEntry) => {
      if (!ids.includes(e.id)) return;
      const before = latest.get(e.id);
      latest.set(e.id, e);
      if (!ctx.json && before && stateOf(before) !== stateOf(e)) {
        progress.clear();
        console.error(`  ${c.dim(shortId(e.id))} ${stateLabel(e)}${e.failReason ? ` ${c.dim(e.failReason)}` : ""}`);
      }
      if ([...latest.values()].filter((x) => TERMINAL.has(x.status)).length === ids.length) finish();
    };
    void client
      .onEvent((ev) => ev.event === "history" && see(ev.data as HistoryEntry))
      .then(async (unsubscribe) => {
        off = unsubscribe;
        for (const e of await client.call("listHistory")) see(e);
        const missing = ids.filter((id) => !latest.has(id));
        if (missing.length) finish(new Error(`No post with ID ${missing.join(", ")}.`));
      })
      .catch(finish);
  });
}

// ── posts ────────────────────────────────────────────────────────────────────

const listCmd: Command = {
  usage: "list [--state <state,…>] [--platform tiktok|instagram] [--account <account>] [-n <count> | --all]",
  summary: "Posts, newest first",
  details: `States: ${STATES.join(", ")}
  -n, --limit <count>   How many (default 20)
  --all                 Every post in the history`,
  options: {
    state: { type: "string", short: "s", multiple: true },
    platform: { type: "string" },
    account: { type: "string", short: "a" },
    limit: { type: "string", short: "n" },
    all: { type: "boolean" },
  },
  async run(ctx) {
    const client = await ctx.client();
    const entries = await filterEntries(ctx, client, await client.call("listHistory"));
    const limit = ctx.values.all ? Infinity : Number(str(ctx.values.limit) ?? 20);
    const shown = entries.slice(0, limit);
    print(ctx, shown, () => {
      if (!shown.length) return "No posts.";
      const more = entries.length - shown.length;
      return table(ENTRY_HEAD, entryRows(shown)) + (more > 0 ? c.dim(`\n…and ${more} more (--all)`) : "");
    });
  },
};

const upcoming: Command = {
  usage: "upcoming [--platform tiktok|instagram] [--account <account>]",
  summary: "Scheduled posts, soonest first (delayed ones on top)",
  options: { platform: { type: "string" }, account: { type: "string", short: "a" } },
  async run(ctx) {
    const client = await ctx.client();
    const entries = (await filterEntries(ctx, client, await client.call("listHistory")))
      .filter((e) => e.status === "SCHEDULED")
      .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
    print(ctx, entries, () => {
      if (!entries.length) return "Nothing scheduled.";
      const rows = entryRows(entries).map((r, i) => {
        r[2] = `${r[2]} ${c.dim(fmtRelative(entries[i].scheduledAt!))}`;
        return r;
      });
      return table(ENTRY_HEAD, rows);
    });
  },
};

async function filterEntries(ctx: Ctx, client: Client, entries: HistoryEntry[]): Promise<HistoryEntry[]> {
  const states = list(ctx.values.state).map((s) => (s === "drafts" ? "draft" : s)) as State[];
  for (const s of states) if (!STATES.includes(s)) throw new UsageError(`Unknown state "${s}". States: ${STATES.join(", ")}.`);
  const platform = str(ctx.values.platform);
  if (platform && platform !== "tiktok" && platform !== "instagram") throw new UsageError("--platform is tiktok or instagram.");
  const account = str(ctx.values.account) ? pickAccount(await allAccounts(client), str(ctx.values.account)!, platform as Platform) : null;
  return entries.filter(
    (e) =>
      (!states.length || states.includes(stateOf(e))) &&
      (!platform || platformOf(e) === platform) &&
      (!account || e.openId === account.id),
  );
}

const show: Command = {
  usage: "show <id>",
  summary: "Everything about one post",
  async run(ctx) {
    const client = await ctx.client();
    const [e] = await resolveEntries(client, need(ctx, 1, "post ID"));
    print(ctx, e, () => entryDetail(e));
  },
};

const wait: Command = {
  usage: "wait <id…> [--timeout <seconds>]",
  summary: "Wait until posts are in the TikTok inbox, published, or failed",
  options: { timeout: { type: "string" } },
  async run(ctx) {
    const client = await ctx.client();
    const entries = await resolveEntries(client, need(ctx, 1, "post ID"));
    const timeout = str(ctx.values.timeout) ? Number(str(ctx.values.timeout)) * 1000 : undefined;
    const final = await waitFor(ctx, client, entries.map((e) => e.id), timeout);
    print(ctx, final, () => table(ENTRY_HEAD, entryRows(final)));
    return final.some((e) => e.status === "FAILED" || e.status === "CANCELLED") ? 1 : 0;
  },
};

const reschedule: Command = {
  usage: "reschedule <id> <when>",
  summary: "Move a scheduled or missed post to a new time",
  details: `When: ${WHEN_HELP}`,
  async run(ctx) {
    const [id, ...when] = need(ctx, 2, "post ID and new time");
    const client = await ctx.client();
    const [e] = await resolveEntries(client, [id]);
    const updated = await client.call("reschedule", e.id, parseWhen(when.join(" ")).toISOString());
    print(ctx, updated, () => `${c.green("✓")} ${shortId(e.id)} now goes out ${fmtTime(updated.scheduledAt)} ${c.dim(`(${fmtRelative(updated.scheduledAt!)})`)}`);
  },
};

const postNow: Command = {
  usage: "post-now <id> [--wait]",
  summary: "Send a scheduled (or missed / failed scheduled) post right away",
  options: { wait: { type: "boolean", short: "w" } },
  async run(ctx) {
    const client = await ctx.client();
    const [e] = await resolveEntries(client, need(ctx, 1, "post ID"));
    const progress = await showProgress(ctx, client, new Set([e.id]));
    await client.call("postScheduledNow", e.id).finally(() => progress.stop());
    const [after] = await resolveEntries(client, [e.id]);
    if (after.status === "FAILED") {
      console.error(`${c.red("✗")} ${shortId(e.id)}: ${after.failReason}`);
      return 1;
    }
    if (ctx.values.wait) {
      const [final] = await waitFor(ctx, client, [e.id]);
      print(ctx, final, () => `${shortId(e.id)} ${stateLabel(final)}`);
      return final.status === "FAILED" ? 1 : 0;
    }
    print(ctx, after, () => `${c.green("✓")} ${shortId(e.id)} sent ${c.dim(`(${stateLabel(after)})`)}`);
  },
};

const cancel: Command = {
  usage: "cancel <id…>",
  summary: "Cancel scheduled posts (their saved file copies are deleted)",
  async run(ctx) {
    const client = await ctx.client();
    const entries = await resolveEntries(client, need(ctx, 1, "post ID"));
    let failed = 0;
    const done: HistoryEntry[] = [];
    for (const e of entries) {
      try {
        done.push(await client.call("cancelScheduled", e.id));
        if (!ctx.json) console.log(`${c.green("✓")} Cancelled ${shortId(e.id)} ${c.dim(e.label)}`);
      } catch (err) {
        failed++;
        console.error(`${c.red("✗")} ${shortId(e.id)}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (ctx.json) console.log(JSON.stringify(done, null, 2));
    return failed ? 1 : 0;
  },
};

const refresh: Command = {
  usage: "refresh <id>",
  summary: "Ask TikTok / Instagram for a post's current status",
  async run(ctx) {
    const client = await ctx.client();
    const [e] = await resolveEntries(client, need(ctx, 1, "post ID"));
    const updated = await client.call("refreshStatus", e.id);
    print(ctx, updated, () => `${shortId(e.id)} ${stateLabel(updated)}${updated.failReason ? `  ${c.dim(updated.failReason)}` : ""}`);
  },
};

const markPublished: Command = {
  usage: "mark-published <id…> [--undo]",
  summary: "Mark TikTok drafts as published once you've finished them on your phone",
  options: { undo: { type: "boolean" } },
  async run(ctx) {
    const client = await ctx.client();
    const entries = await resolveEntries(client, need(ctx, 1, "post ID"));
    const done: HistoryEntry[] = [];
    for (const e of entries) done.push(await client.call("setFinished", e.id, !ctx.values.undo));
    print(ctx, done, () => done.map((e) => `${c.green("✓")} ${shortId(e.id)} ${stateLabel(e)}`).join("\n"));
  },
};

const remove: Command = {
  usage: "remove <id…> [--yes]",
  summary: "Delete posts from the history (a scheduled one won't go out)",
  async run(ctx) {
    const client = await ctx.client();
    const entries = await resolveEntries(client, need(ctx, 1, "post ID"));
    const pending = entries.filter((e) => e.status === "SCHEDULED").length;
    const q = `Delete ${entries.length} post${entries.length === 1 ? "" : "s"} from the history${pending ? ` (${pending} still scheduled, which won't go out)` : ""}?`;
    if (!(await confirm(ctx, q))) return 1;
    for (const e of entries) await client.call("removeHistory", e.id);
    print(ctx, { removed: entries.map((e) => e.id) }, () => `${c.green("✓")} Deleted ${entries.length}`);
  },
};

const clearCancelled: Command = {
  usage: "clear-cancelled [--yes]",
  summary: "Delete every cancelled post from the history",
  async run(ctx) {
    const client = await ctx.client();
    const ids = (await client.call("listHistory")).filter((e) => e.status === "CANCELLED").map((e) => e.id);
    if (!ids.length) return print(ctx, { removed: 0 }, () => "No cancelled posts.");
    if (!(await confirm(ctx, `Delete ${ids.length} cancelled post${ids.length === 1 ? "" : "s"}?`))) return 1;
    const n = await client.call("clearCancelled", ids);
    print(ctx, { removed: n }, () => `${c.green("✓")} Deleted ${n}`);
  },
};

const importCmd: Command = {
  usage: "import <manifest.json|-> [--no-wait]",
  summary: "Bulk-schedule a manifest through the app's import inbox",
  details: `The manifest is the import-folder format (see "Bulk scheduling" in the README). Relative file paths are
resolved against the manifest's folder. Waits for the app to pick it up (up to a minute) and prints each post's
ID or error, unless --no-wait.`,
  options: { "no-wait": { type: "boolean" } },
  async run(ctx) {
    const [src] = need(ctx, 1, "manifest path");
    const raw = src === "-" ? await readStdin() : await readFile(resolve(src), "utf8");
    const base = src === "-" ? process.cwd() : dirname(resolve(src));
    const doc = JSON.parse(raw) as { posts?: Array<{ filePath?: string; filePaths?: string[] }> };
    for (const p of doc.posts ?? []) {
      if (p.filePath) p.filePath = resolve(base, p.filePath);
      if (p.filePaths) p.filePaths = p.filePaths.map((f) => resolve(base, f));
    }
    // Make sure the app is up to read it.
    (await ctx.client()).close();

    const dir = join(userDataDir(), "import");
    await mkdir(dir, { recursive: true });
    const name = `cli-${new Date().toISOString().replace(/[:.]/g, "-")}-${basename(src === "-" ? "stdin" : src, ".json")}`;
    await writeFile(join(dir, `${name}.tmp`), JSON.stringify(doc, null, 1));
    await rename(join(dir, `${name}.tmp`), join(dir, `${name}.json`));
    if (ctx.values["no-wait"]) return print(ctx, { queued: `${name}.json` }, () => `Queued ${name}.json; the app picks it up within 15s.`);

    if (!ctx.json) process.stderr.write(c.dim("Waiting for the app to pick it up…\n"));
    const resultPath = join(dir, "done", `${name}.result.json`);
    const until = Date.now() + 60_000;
    while (!existsSync(resultPath)) {
      if (Date.now() > until) throw new Error(`The app hasn't read ${name}.json yet; it's still queued in ${dir}.`);
      await new Promise((r) => setTimeout(r, 500));
    }
    const result = JSON.parse(await readFile(resultPath, "utf8")) as { results: Array<Record<string, unknown>> };
    print(ctx, result, () =>
      result.results
        .map((r) =>
          r.cancelled
            ? `${r.error ? c.red("✗") : c.green("✓")} cancel ${shortId(String(r.cancelled))}${r.error ? `: ${r.error}` : ""}`
            : r.error
              ? `${c.red("✗")} ${r.i !== undefined ? `#${Number(r.i) + 1} ` : ""}${r.filePath ?? ""}: ${r.error}`
              : `${c.green("✓")} #${Number(r.i) + 1} ${fmtTime(String(r.at))}  ${c.dim(`id ${shortId(String(r.entryId))}`)}  ${r.filePath}`,
        )
        .join("\n"),
    );
    return result.results.some((r) => r.error) ? 1 : 0;
  },
};

// ── app ──────────────────────────────────────────────────────────────────────

const status: Command = {
  usage: "status",
  summary: "Is the app running, what's waiting, and what's next",
  async run(ctx) {
    const client = await ctx.client();
    const [ping, accts, entries] = await Promise.all([client.call("ping"), allAccounts(client), client.call("listHistory")]);
    const counts = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<State, number>;
    for (const e of entries) counts[stateOf(e)]++;
    const next = entries
      .filter((e) => e.status === "SCHEDULED" && Date.parse(e.scheduledAt!) > Date.now())
      .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))[0];
    const problems = accts.filter((a) => a.tiktok?.loginProblem ?? a.instagram?.loginProblem);
    print(ctx, { ...ping, accounts: accts.length, counts, next: next ?? null }, () => {
      const n = (k: State, color: (s: string) => string, label: string = k) => (counts[k] ? color(`${counts[k]} ${label}`) : null);
      const drafts = counts.draft === 1 ? "draft to finish" : "drafts to finish";
      const lines = [
        `${c.bold("TikTok Poster")} ${ping.version} · running ${c.dim(`(pid ${ping.pid})`)}${ping.mockMode ? ` · ${c.yellow("mock mode")}` : ""}`,
        `${c.dim("Data")}      ${ping.userData}`,
        `${c.dim("Accounts")}  ${accts.filter((a) => a.platform === "tiktok").length} TikTok, ${accts.filter((a) => a.platform === "instagram").length} Instagram` +
          (problems.length ? c.red(` · reconnect ${problems.map((a) => a.name).join(", ")}`) : ""),
        `${c.dim("Posts")}     ` +
          ([
            n("scheduled", c.magenta),
            n("delayed", c.orange),
            n("sending", c.yellow),
            n("draft", c.cyan, drafts),
            n("failed", c.red),
            n("missed", c.red),
          ]
            .filter(Boolean)
            .join(" · ") || "nothing waiting"),
      ];
      if (next) lines.push(`${c.dim("Next")}      ${fmtTime(next.scheduledAt)} ${c.dim(`(${fmtRelative(next.scheduledAt!)})`)}  ${next.accountName ?? ""}  ${next.label}  ${c.dim(shortId(next.id))}`);
      return lines.join("\n");
    });
  },
};

type SettingType = "string" | "secret" | "bool" | "number";
const SETTINGS: Array<{ key: string; field: keyof SettingsUpdate; type: SettingType; show(v: SettingsView): string }> = [
  { key: "client-key", field: "clientKey", type: "string", show: (v) => v.clientKey },
  { key: "client-secret", field: "clientSecret", type: "secret", show: (v) => (v.hasClientSecret ? "set" : "") },
  { key: "direct-post", field: "directPostEnabled", type: "bool", show: (v) => String(v.directPostEnabled) },
  { key: "oauth-port", field: "oauthPort", type: "number", show: (v) => String(v.oauthPort) },
  { key: "r2-account-id", field: "r2AccountId", type: "string", show: (v) => v.r2AccountId },
  { key: "r2-access-key-id", field: "r2AccessKeyId", type: "string", show: (v) => v.r2AccessKeyId },
  { key: "r2-secret-access-key", field: "r2SecretAccessKey", type: "secret", show: (v) => (v.hasR2SecretAccessKey ? "set" : "") },
  { key: "r2-bucket", field: "r2Bucket", type: "string", show: (v) => v.r2Bucket },
  { key: "r2-public-base-url", field: "r2PublicBaseUrl", type: "string", show: (v) => v.r2PublicBaseUrl },
  { key: "r2-key-prefix", field: "r2KeyPrefix", type: "string", show: (v) => v.r2KeyPrefix },
  { key: "carousel-folder", field: "carouselFolder", type: "string", show: (v) => v.carouselFolder },
  { key: "appearance", field: "appearance", type: "string", show: (v) => v.appearance },
  { key: "ig-app-id", field: "igAppId", type: "string", show: (v) => v.igAppId },
  { key: "ig-app-secret", field: "igAppSecret", type: "secret", show: (v) => (v.hasIgAppSecret ? "set" : "") },
  { key: "ig-redirect-uri", field: "igRedirectUri", type: "string", show: (v) => v.igRedirectUri },
];

function settingsText(v: SettingsView): string {
  const rows: Array<[string, string]> = [
    ...SETTINGS.map((s) => [s.key, s.show(v)] as [string, string]),
    ["redirect-uri", `${v.redirectUri} ${c.dim("(read-only; register it with TikTok)")}`],
    ["mock-mode", `${v.mockMode} ${c.dim("(read-only; on while client-key is empty)")}`],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, val]) => `${c.dim(k.padEnd(w))}  ${val || c.dim("—")}`).join("\n");
}

const settings: Command = {
  usage: "settings [set <key> <value> | set <key>=<value>… | test-r2]",
  summary: "Show or change settings (API keys, R2, appearance…)",
  details: `Keys: ${SETTINGS.map((s) => s.key).join(", ")}
Secrets are stored encrypted and never shown. Pass "-" as the value to read one from stdin, e.g.
  pbpaste | tiktok-poster settings set r2-secret-access-key -
Setting client-key turns mock mode off (empty turns it back on).`,
  async run(ctx) {
    const [sub, ...rest] = ctx.positionals;
    const client = await ctx.client();
    if (!sub || sub === "get" || sub === "show") {
      const v = await client.call("getSettings");
      return print(ctx, v, () => settingsText(v));
    }
    if (sub === "test-r2") {
      const r = await client.call("testR2");
      print(ctx, r, () => `${r.ok ? c.green("✓") : c.red("✗")} ${r.message}`);
      return r.ok ? 0 : 1;
    }
    if (sub === "set") {
      const pairs: Array<[string, string]> =
        rest.length === 2 && !rest[0].includes("=") ? [[rest[0], rest[1]]] : rest.map((a) => {
          const i = a.indexOf("=");
          if (i < 1) throw new UsageError(`Expected key=value, got "${a}".`);
          return [a.slice(0, i), a.slice(i + 1)];
        });
      if (!pairs.length) throw new UsageError("settings set <key> <value>");
      const update: SettingsUpdate = {};
      for (const [key, raw] of pairs) {
        const s = SETTINGS.find((x) => x.key === key || x.field === key);
        if (!s) throw new UsageError(`Unknown setting "${key}". Keys: ${SETTINGS.map((x) => x.key).join(", ")}.`);
        const value = await valueOrStdin(raw);
        if (s.type === "bool") {
          if (!/^(true|false|on|off|yes|no)$/i.test(value)) throw new UsageError(`${s.key} is true or false.`);
          (update as Record<string, unknown>)[s.field] = /^(true|on|yes)$/i.test(value);
        } else if (s.type === "number") {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new UsageError(`${s.key} is a port number from 1024 to 65535.`);
          (update as Record<string, unknown>)[s.field] = n;
        } else if (s.key === "appearance" && !["system", "light", "dark"].includes(value)) {
          throw new UsageError("appearance is system, light or dark.");
        } else {
          (update as Record<string, unknown>)[s.field] = value;
        }
      }
      const v = await client.call("saveSettings", update);
      return print(ctx, v, () => `${c.green("✓")} Saved ${pairs.map(([k]) => k).join(", ")}${"clientKey" in update ? c.dim(v.mockMode ? " · mock mode on" : " · mock mode off") : ""}`);
    }
    throw new UsageError(`Unknown subcommand: settings ${sub}`);
  },
};

const watch: Command = {
  usage: "watch",
  summary: "Stream upload progress and status changes until Ctrl-C (--json: one event per line)",
  async run(ctx) {
    const client = await ctx.client();
    if (!ctx.json) process.stderr.write(c.dim("Watching… (Ctrl-C to stop)\n"));
    // A post's entry is saved many times on the way out; only show it when what you'd see changes.
    const last = new Map<string, string>();
    await client.onEvent((ev) => {
      if (ctx.json) return console.log(JSON.stringify(ev));
      const time = c.dim(new Date().toLocaleTimeString("en-US", { hourCycle: "h23" }));
      if (ev.event === "progress") {
        const p = ev.data as Progress;
        if (!p.stage) return;
        console.log(`${time} ${c.dim(shortId(p.entryId))} ${p.stage}${p.fraction === null ? "" : ` ${Math.round(p.fraction * 100)}%`}`);
      } else {
        const e = ev.data as HistoryEntry;
        const seen = `${stateOf(e)}|${e.failReason}`;
        if (last.get(e.id) === seen) return;
        last.set(e.id, seen);
        console.log(`${time} ${c.dim(shortId(e.id))} ${stateLabel(e)}  ${e.accountName ?? ""}  ${e.label}${e.failReason ? `  ${c.red(e.failReason)}` : ""}`);
      }
    });
    await new Promise(() => {});
  },
};

const open: Command = {
  usage: `open [${VIEWS.join("|")}]`,
  summary: "Bring up the app window, optionally on a view",
  async run(ctx) {
    const view = ctx.positionals[0] as View | undefined;
    if (view && !VIEWS.includes(view)) throw new UsageError(`Views: ${VIEWS.join(", ")}.`);
    await (await ctx.client()).call("show", view);
  },
};

export const COMMANDS: Record<string, Command> = {
  "post video": postVideo,
  "post carousel": postCarousel,
  import: importCmd,
  list: listCmd,
  upcoming,
  show,
  wait,
  reschedule,
  "post-now": postNow,
  cancel,
  refresh,
  "mark-published": markPublished,
  remove,
  "clear-cancelled": clearCancelled,
  accounts,
  status,
  settings,
  watch,
  open,
};

export const ALIASES: Record<string, string> = {
  ls: "list",
  history: "list",
  scheduled: "upcoming",
  rm: "remove",
  account: "accounts",
  "post photos": "post carousel",
  "post photo": "post carousel",
  "post reel": "post video",
};
