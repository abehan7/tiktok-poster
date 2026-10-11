import { app, clipboard, Notification, type BrowserWindow } from "electron";
import type { HistoryEntry } from "@shared/contract";
import { describeTikTokError } from "@shared/tiktokErrors";
import type { HistoryStore } from "../store/history";

/**
 * TikTok drafts need a human: the API can only drop them in the TikTok inbox, so each one has to be opened in the
 * app and posted. This tells you when that's due: a macOS notification when a draft lands (click it to copy the
 * caption), another if TikTok refuses one, and a Dock badge counting drafts you haven't marked posted yet.
 * Instagram posts go out on their own and don't notify.
 */
export class DraftNotifier {
  private readonly last = new Map<string, HistoryEntry["status"]>();
  // Notification objects must stay referenced or macOS drops their click handlers.
  private readonly live = new Set<Notification>();

  constructor(
    private readonly history: HistoryStore,
    private readonly window: () => BrowserWindow | null,
  ) {
    for (const e of history.list()) this.last.set(e.id, e.status);
    this.syncBadge();
  }

  /** Call on every history change. */
  onHistory(e: HistoryEntry): void {
    const before = this.last.get(e.id);
    this.last.set(e.id, e.status);
    if (isTikTok(e) && before !== e.status) {
      if (e.status === "SEND_TO_USER_INBOX" && e.mode === "DRAFT") this.draftReady(e);
      if (e.status === "FAILED" && e.mode === "DRAFT" && before) this.draftFailed(e);
    }
    this.syncBadge();
  }

  private draftReady(e: HistoryEntry) {
    const caption = e.content?.description || e.content?.title || "";
    this.show(
      {
        title: "TikTok draft uploaded — time to post",
        subtitle: e.accountName ?? undefined,
        body: `${firstLine(caption) || e.label}\nClick to copy the caption, then open TikTok → Inbox and post it.`,
        sound: "Glass",
      },
      () => {
        if (caption) clipboard.writeText(caption);
        this.focus();
      },
    );
  }

  private draftFailed(e: HistoryEntry) {
    this.show(
      {
        title: "TikTok draft didn't upload",
        subtitle: e.accountName ?? undefined,
        body: `${firstLine(e.content?.title || e.label)}\n${describeTikTokError(e.failReason ?? "Unknown error")}`,
        sound: "Basso",
      },
      () => this.focus(),
    );
  }

  private show(options: Electron.NotificationConstructorOptions, onClick: () => void) {
    if (!Notification.isSupported()) return;
    const n = new Notification(options);
    this.live.add(n);
    n.on("click", () => {
      onClick();
      this.live.delete(n);
    });
    n.on("close", () => this.live.delete(n));
    n.show();
  }

  private focus() {
    const w = this.window();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
    app.focus({ steal: true });
  }

  /** Dock badge: TikTok drafts waiting to be posted by hand. */
  private syncBadge() {
    const waiting = this.history.list().filter((e) => isTikTok(e) && e.status === "SEND_TO_USER_INBOX" && e.mode === "DRAFT" && !e.finishedAt).length;
    app.setBadgeCount(waiting);
  }
}

const isTikTok = (e: HistoryEntry) => (e.platform ?? "tiktok") === "tiktok";
const firstLine = (s: string) => s.split("\n")[0].slice(0, 120);
