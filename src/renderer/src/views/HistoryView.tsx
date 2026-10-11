import { useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarClock, Check, ChevronDown, Copy, ExternalLink, Film, Images, RefreshCw, RotateCcw, Send, Trash2, X } from "lucide-react";
import type { HistoryEntry } from "@shared/contract";
import { describeTikTokError } from "@shared/tiktokErrors";
import { AccountAvatar, AccountBar } from "@renderer/components/AccountBar";
import { PlatformIcon, platformOf } from "@renderer/components/Platform";
import { PostDetail } from "@renderer/components/PostDetail";
import { formatWhen, toLocalInput } from "@renderer/components/SchedulePicker";
import { Button, Card, Input } from "@renderer/components/ui";
import { accountKey, groupByAccount, useAccountRefs, type AccountRef } from "@renderer/lib/accounts";
import { poster, timeAgo } from "@renderer/lib/api";
import { ATTENTION, derive, lateText } from "@renderer/lib/post-state";
import { useHistory, type HistoryApi } from "@renderer/lib/use-history";

export function HistoryView({ account, onAccount }: { account: string; onAccount(id: string): void }) {
  const api = useHistory();
  const { entries, error } = api;
  const refs = useAccountRefs(entries);
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const opened = entries.find((e) => e.id === openId) ?? null;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) c[accountKey(e)] = (c[accountKey(e)] ?? 0) + 1;
    return c;
  }, [entries]);

  if (entries.length === 0) {
    return (
      <Card className="py-16 text-center text-sm text-muted">Nothing posted yet. Your uploads show up here.</Card>
    );
  }

  // A remembered account that has nothing here falls back to everything.
  const current = account !== "all" && refs.some((r) => r.id === account) ? account : "all";
  const open = (id: string) => setOpenId(id);

  return (
    <div className="space-y-5">
      <AccountBar refs={refs} value={current} onChange={onAccount} counts={counts} total={entries.length} />
      {error && <p className="selectable text-sm text-bad">{error}</p>}
      {current === "all" ? (
        groupByAccount(refs, entries, (e) => e).map(({ ref, items }) => {
          const isCollapsed = collapsed.has(ref.id);
          return (
            <section key={ref.id} className="space-y-3">
              <AccountHeader
                account={ref}
                entries={items}
                now={api.now}
                collapsed={isCollapsed}
                onToggle={() =>
                  setCollapsed((cur) => {
                    const next = new Set(cur);
                    if (next.has(ref.id)) next.delete(ref.id);
                    else next.add(ref.id);
                    return next;
                  })
                }
                onOpen={() => onAccount(ref.id)}
              />
              {!isCollapsed && <PostLists entries={items} api={api} onOpen={open} limit={3} onMore={() => onAccount(ref.id)} />}
            </section>
          );
        })
      ) : (
        <PostLists entries={entries.filter((e) => accountKey(e) === current)} api={api} onOpen={open} />
      )}
      {opened && <PostDetail entry={opened} now={api.now} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** Account name, a one-line summary, and collapse / open-account controls. */
function AccountHeader({
  account,
  entries,
  now,
  collapsed,
  onToggle,
  onOpen,
}: {
  account: AccountRef;
  entries: HistoryEntry[];
  now: number;
  collapsed: boolean;
  onToggle(): void;
  onOpen(): void;
}) {
  const states = entries.map((e) => derive(e, now).state);
  const upcoming = entries
    .filter((e) => e.status === "SCHEDULED" && e.scheduledAt)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const attention = states.filter((s) => ATTENTION.includes(s)).length;
  const sent = states.filter((s) => s === "posted" || s === "published").length;

  return (
    <div className="sticky -top-6 z-20 -mx-1 flex items-center gap-3 rounded-xl bg-bg/95 px-1 py-2 backdrop-blur">
      <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={!collapsed}>
        <ChevronDown size={16} className={clsx("shrink-0 text-muted transition-transform", collapsed && "-rotate-90")} />
        <AccountAvatar account={account} size={30} />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{account.handle}</span>
            {!account.connected && <span className="text-xs font-normal text-muted">not connected</span>}
          </span>
          <span className="flex flex-wrap gap-x-2 text-xs text-muted">
            <span>
              <span className="text-sched">{upcoming.length}</span> scheduled
            </span>
            {upcoming[0] && <span>· next {formatWhen(upcoming[0].scheduledAt!)}</span>}
            <span>· {sent} sent</span>
            {attention > 0 && <span className="font-medium text-bad">· {attention} need attention</span>}
          </span>
        </span>
      </button>
      <Button size="sm" variant="ghost" onClick={onOpen}>
        Only this account
      </Button>
    </div>
  );
}

/** Scheduled (soonest first), then everything else. With `limit`, each list is cut short and `onMore` shows the rest. */
function PostLists({
  entries,
  api,
  onOpen,
  limit,
  onMore,
}: {
  entries: HistoryEntry[];
  api: HistoryApi;
  onOpen(id: string): void;
  limit?: number;
  onMore?(): void;
}) {
  const upcoming = entries
    .filter((e) => e.status === "SCHEDULED")
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const past = entries.filter((e) => e.status !== "SCHEDULED");
  const nested = limit !== undefined;

  const list = (items: HistoryEntry[]) => (
    <>
      {items.slice(0, limit).map((e) => (
        <HistoryRow key={e.id} entry={e} api={api} onOpen={() => onOpen(e.id)} compact={nested} />
      ))}
      {limit !== undefined && items.length > limit && (
        <button type="button" onClick={onMore} className="px-1 text-xs font-medium text-muted hover:text-text">
          Show all {items.length} →
        </button>
      )}
    </>
  );

  return (
    <div className={nested ? "ml-2 space-y-4 border-l border-line pl-4" : "space-y-6"}>
      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock size={15} className="text-sched" /> Scheduled · {upcoming.length}
          </h3>
          {list(upcoming)}
        </section>
      )}
      {past.length > 0 && (
        <section className="space-y-3">
          {upcoming.length > 0 && <h3 className="text-sm font-semibold">History · {past.length}</h3>}
          {list(past)}
        </section>
      )}
    </div>
  );
}

function inHowLong(iso: string, now: number): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000);
  if (mins <= 0) return `due ${-mins}m ago`;
  if (mins < 60) return `in ${mins} min`;
  if (mins < 48 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ""}`.trim();
  return `in ${Math.round(mins / 1440)} days`;
}

/** One post with its status and actions. Click opens the detail view. Used by History and Calendar. */
export function HistoryRow({
  entry: e,
  api,
  onOpen,
  compact,
}: {
  entry: HistoryEntry;
  api: HistoryApi;
  onOpen(): void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState("");
  const d = derive(e, api.now);
  const busy = api.busyId === e.id;
  const scheduled = e.status === "SCHEDULED";
  // A failed or missed scheduled post keeps its files, so it can still be sent or moved.
  const retryable = e.status === "FAILED" && e.hasJob;
  const platform = platformOf(e);

  return (
    <Card className={clsx("space-y-3 transition-colors hover:border-muted/40", compact ? "p-2.5" : "p-3")}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left"
          title="Open post"
        >
          <div className={clsx("relative shrink-0 overflow-hidden rounded-lg bg-sunken", compact ? "size-12" : "size-16")}>
            <span className="absolute bottom-0.5 right-0.5 z-10 grid size-5 place-items-center rounded-md bg-panel/90">
              <PlatformIcon platform={platform} size={13} />
            </span>
            {e.thumbUrl && e.kind === "photo" ? (
              <img src={e.thumbUrl} alt="" className="size-full object-cover" onError={(ev) => (ev.currentTarget.style.display = "none")} />
            ) : (
              <div className="grid size-full place-items-center text-muted">
                {e.kind === "video" ? <Film size={20} /> : <Images size={20} />}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-medium">{e.label}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className={clsx("rounded-full px-2 py-0.5 font-medium", d.tone)}>{d.label}</span>
              {e.scheduledAt && (
                <span className={clsx(scheduled && "font-medium text-text")}>
                  {formatWhen(e.scheduledAt)}
                  {scheduled && <span className="font-normal text-muted"> ({inHowLong(e.scheduledAt, api.now)})</span>}
                </span>
              )}
              {d.lateMin !== null && <span className="text-warn">{lateText(d.lateMin)}</span>}
              {platform === "instagram" ? (
                <span>{e.kind === "video" ? "Instagram Reel" : `Instagram ${(e.content?.images.length ?? 2) > 1 ? "carousel" : "photo"}`}</span>
              ) : (
                <>
                  <span>{e.kind === "video" ? "Video" : "Carousel"}</span>
                  <span>·</span>
                  <span>{e.mode === "DIRECT" ? "Direct post" : "Draft"}</span>
                </>
              )}
              {e.accountName && (
                <>
                  <span>·</span>
                  <span className="font-medium text-text">{e.accountName}</span>
                </>
              )}
              {!e.scheduledAt && (
                <>
                  <span>·</span>
                  <span>{timeAgo(e.createdAt)}</span>
                </>
              )}
            </div>
            {d.state === "draft" && (
              <p className="text-xs text-cyan">In the TikTok inbox: add a sound and publish, then mark it published.</p>
            )}
            {d.state === "delayed" && (
              <p className="text-xs text-warn">Past its time and not sent yet. It goes out on the next check while the app is open, or post it now.</p>
            )}
            {e.failReason && <p className="text-xs text-bad">{describeTikTokError(e.failReason)}</p>}
          </div>
        </button>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {(scheduled || retryable) && (
            <>
              <Button size="sm" onClick={() => api.postNow(e.id)} disabled={busy}>
                <Send size={13} /> {busy ? "Posting…" : "Post now"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const base = e.scheduledAt && Date.parse(e.scheduledAt) > Date.now() ? e.scheduledAt : Date.now() + 3600_000;
                  setWhen(toLocalInput(new Date(base)));
                  setEditing((v) => !v);
                }}
              >
                Reschedule
              </Button>
            </>
          )}
          {d.state === "draft" && (
            <Button size="sm" onClick={() => api.setFinished(e.id, true)} disabled={busy}>
              <Check size={13} /> Mark posted
            </Button>
          )}
          {d.state === "published" && (
            <Button size="sm" variant="ghost" onClick={() => api.setFinished(e.id, false)} disabled={busy} title="Undo: back to draft">
              <RotateCcw size={13} />
            </Button>
          )}
          {e.permalink && (
            <Button size="sm" variant="ghost" onClick={() => poster.openExternal(e.permalink!)} title="Open on Instagram">
              <ExternalLink size={13} />
            </Button>
          )}
          {e.postIds.length > 0 && !e.permalink && (
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(e.postIds[0])} title="Copy post ID">
              <Copy size={13} />
            </Button>
          )}
          {scheduled ? (
            <Button size="sm" variant="danger" onClick={() => api.cancel(e.id)} disabled={busy} title="Cancel this scheduled post">
              <X size={13} /> Cancel
            </Button>
          ) : (
            <>
              {e.publishId && (
                <Button variant="ghost" size="sm" onClick={() => api.refresh(e.id)} disabled={busy} title="Refresh status">
                  <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
                </Button>
              )}
              <Button variant="ghost" size="sm" title="Remove from history" onClick={() => api.remove(e.id)}>
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-2 pl-20">
          <Input
            type="datetime-local"
            value={when}
            min={toLocalInput(new Date(Date.now() + 60_000))}
            onChange={(ev) => setWhen(ev.target.value)}
            className="max-w-64"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!when || new Date(when).getTime() < Date.now() + 60_000}
            onClick={() => {
              void api.reschedule(e.id, new Date(when).toISOString());
              setEditing(false);
            }}
          >
            Save time
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Close
          </Button>
        </div>
      )}
    </Card>
  );
}
