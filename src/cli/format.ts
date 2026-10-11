import type { HistoryEntry, PrivacyLevel } from "@shared/contract";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  magenta: paint("35"),
  cyan: paint("36"),
  orange: paint("38;5;208"),
};

/** One word per post state, the same vocabulary as the app's status colours. */
export type State = "scheduled" | "delayed" | "sending" | "draft" | "published" | "failed" | "missed" | "cancelled";
export const STATES: State[] = ["scheduled", "delayed", "sending", "draft", "published", "failed", "missed", "cancelled"];

export function stateOf(e: HistoryEntry, now = Date.now()): State {
  switch (e.status) {
    case "SCHEDULED":
      return e.scheduledAt && Date.parse(e.scheduledAt) <= now ? "delayed" : "scheduled";
    case "CANCELLED":
      return "cancelled";
    case "SEND_TO_USER_INBOX":
      return e.finishedAt ? "published" : "draft";
    case "PUBLISH_COMPLETE":
      return "published";
    case "FAILED":
      return e.failReason?.startsWith("Missed") ? "missed" : "failed";
    default:
      return "sending";
  }
}

const STATE_STYLE: Record<State, [string, (s: string) => string]> = {
  scheduled: ["scheduled", c.magenta],
  delayed: ["delayed", c.orange],
  sending: ["sending", c.yellow],
  draft: ["draft ready", c.cyan],
  published: ["published", c.green],
  failed: ["failed", c.red],
  missed: ["missed", c.red],
  cancelled: ["cancelled", c.dim],
};

export function stateLabel(e: HistoryEntry): string {
  const [label, color] = STATE_STYLE[stateOf(e)];
  return color(label);
}

export const PRIVACY: Record<string, PrivacyLevel> = {
  public: "PUBLIC_TO_EVERYONE",
  everyone: "PUBLIC_TO_EVERYONE",
  friends: "MUTUAL_FOLLOW_FRIENDS",
  followers: "FOLLOWER_OF_CREATOR",
  private: "SELF_ONLY",
  "only-me": "SELF_ONLY",
  self: "SELF_ONLY",
};

export function privacyName(p: PrivacyLevel): string {
  return { PUBLIC_TO_EVERYONE: "public", MUTUAL_FOLLOW_FRIENDS: "friends", FOLLOWER_OF_CREATOR: "followers", SELF_ONLY: "private" }[p];
}

export const shortId = (id: string) => id.slice(0, 8);
export const platformOf = (e: HistoryEntry) => e.platform ?? "tiktok";

/** When the post goes / went out: scheduled time, else when it was sent. */
export function whenOf(e: HistoryEntry): string {
  return e.scheduledAt ?? e.sentAt ?? e.createdAt;
}

export function fmtTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${date} ${time}`;
}

/** "in 2h 5m" / "3d ago". */
export function fmtRelative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  let mins = Math.round(Math.abs(diff) / 60_000);
  if (mins < 1) return diff >= 0 ? "now" : "just now";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  mins %= 60;
  const span = d ? `${d}d${h ? ` ${h}h` : ""}` : h ? `${h}h${mins ? ` ${mins}m` : ""}` : `${mins}m`;
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}

/** File path behind a media:// URL (or the URL itself, e.g. an R2 link). */
export function mediaPath(url: string): string {
  if (!url.startsWith("media:")) return url;
  return new URL(url).searchParams.get("p") ?? url;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const width = (s: string) => [...s.replace(ANSI, "")].length;

function fit(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** Plain aligned columns; the last column is cut to the terminal width. */
export function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ""))));
  const cols = process.stdout.columns ?? 120;
  const used = widths.slice(0, -1).reduce((a, w) => a + w + 2, 0);
  const pad = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? fit(cell, Math.max(10, cols - used)) : cell + " ".repeat(widths[i] - width(cell))))
      .join("  ")
      .trimEnd();
  return [c.dim(pad(head)), ...rows.map(pad)].join("\n");
}

export function entryRows(entries: HistoryEntry[]): string[][] {
  return entries.map((e) => [
    c.dim(shortId(e.id)),
    stateLabel(e),
    fmtTime(whenOf(e)),
    platformOf(e) === "instagram" ? "instagram" : "tiktok",
    e.accountName ?? "—",
    platformOf(e) === "instagram" ? e.kind : `${e.kind} ${e.mode === "DRAFT" ? "draft" : "direct"}`,
    e.label.replace(/\s+/g, " "),
  ]);
}

export const ENTRY_HEAD = ["ID", "STATE", "WHEN", "PLATFORM", "ACCOUNT", "TYPE", "LABEL"];

export function entryDetail(e: HistoryEntry): string {
  const ig = platformOf(e) === "instagram";
  const lines: Array<[string, string | null | undefined]> = [
    ["ID", e.id],
    ["State", stateLabel(e) + (e.hasJob ? c.dim("  (schedule saved: post-now / reschedule / cancel work)") : "")],
    ["Platform", ig ? "Instagram" : "TikTok"],
    ["Account", e.accountName ? `${e.accountName}  ${c.dim(e.openId ?? "")}` : null],
    ["Type", ig ? (e.kind === "video" ? "Reel" : "photo post") : `${e.kind === "video" ? "video" : "photo carousel"}, ${e.mode === "DRAFT" ? "draft to inbox" : "direct post"}`],
    ["Scheduled", e.scheduledAt ? `${fmtTime(e.scheduledAt)}  ${c.dim(fmtRelative(e.scheduledAt))}` : null],
    ["Sent", e.sentAt ? fmtTime(e.sentAt) : null],
    ["Finished", e.finishedAt ? fmtTime(e.finishedAt) : null],
    ["Created", fmtTime(e.createdAt)],
    ["Updated", fmtTime(e.updatedAt)],
    ["Publish ID", e.publishId],
    ["Post IDs", e.postIds.length ? e.postIds.join(", ") : null],
    ["Link", e.permalink],
    ["Problem", e.failReason ? c.red(e.failReason) : null],
  ];
  const ct = e.content;
  if (ct) {
    lines.push(
      ["Title", ct.title || null],
      ["Privacy", !ig && e.mode === "DIRECT" && ct.privacyLevel ? privacyName(ct.privacyLevel) : null],
      ["Auto music", !ig && e.kind === "photo" && ct.autoAddMusic ? "on" : null],
      ["Video", ct.video ? mediaPath(ct.video) : null],
    );
  }
  const labelW = Math.max(...lines.map(([k]) => k.length));
  const out = lines.filter(([, v]) => v).map(([k, v]) => `${c.dim(k.padEnd(labelW))}  ${v}`);
  if (ct?.images.length) {
    out.push(`${c.dim("Images".padEnd(labelW))}  ${ct.images.length}${e.kind === "photo" && !ig ? c.dim(`, cover = #${ct.coverIndex + 1}`) : ""}`);
    for (const [i, url] of ct.images.entries()) out.push(`${" ".repeat(labelW)}  ${c.dim(`${i + 1}.`)} ${mediaPath(url)}`);
  }
  if (ct?.description) out.push("", ct.description);
  return out.join("\n");
}
