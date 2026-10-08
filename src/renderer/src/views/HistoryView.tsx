import { useState } from "react";
import clsx from "clsx";
import { CalendarClock, Check, Copy, Film, Images, RefreshCw, RotateCcw, Send, Trash2, X } from "lucide-react";
import type { HistoryEntry } from "@shared/contract";
import { describeTikTokError } from "@shared/tiktokErrors";
import { PostDetail } from "@renderer/components/PostDetail";
import { formatWhen, toLocalInput } from "@renderer/components/SchedulePicker";
import { Button, Card, Input } from "@renderer/components/ui";
import { timeAgo } from "@renderer/lib/api";
import { derive, lateText } from "@renderer/lib/post-state";
import { useHistory, type HistoryApi } from "@renderer/lib/use-history";

export function HistoryView() {
  const api = useHistory();
  const { entries, error } = api;
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = entries.find((e) => e.id === openId) ?? null;

  if (entries.length === 0) {
    return (
      <Card className="py-16 text-center text-sm text-muted">Nothing posted yet. Your uploads show up here.</Card>
    );
  }

  const upcoming = entries
    .filter((e) => e.status === "SCHEDULED")
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const past = entries.filter((e) => e.status !== "SCHEDULED");

  return (
    <div className="space-y-6">
      {error && <p className="selectable text-sm text-bad">{error}</p>}
      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock size={15} className="text-sched" /> Scheduled · {upcoming.length}
          </h2>
          {upcoming.map((e) => (
            <HistoryRow key={e.id} entry={e} api={api} onOpen={() => setOpenId(e.id)} />
          ))}
        </section>
      )}
      {past.length > 0 && (
        <section className="space-y-3">
          {upcoming.length > 0 && <h2 className="text-sm font-semibold">History</h2>}
          {past.map((e) => (
            <HistoryRow key={e.id} entry={e} api={api} onOpen={() => setOpenId(e.id)} />
          ))}
        </section>
      )}
      {opened && <PostDetail entry={opened} now={api.now} onClose={() => setOpenId(null)} />}
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

  return (
    <Card className={clsx("space-y-3 transition-colors hover:border-muted/40", compact ? "p-2.5" : "p-3")}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left"
          title="Open post"
        >
          <div className={clsx("shrink-0 overflow-hidden rounded-lg bg-sunken", compact ? "size-12" : "size-16")}>
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
              <span>{e.kind === "video" ? "Video" : "Carousel"}</span>
              <span>·</span>
              <span>{e.mode === "DIRECT" ? "Direct post" : "Draft"}</span>
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
              <Check size={13} /> Mark published
            </Button>
          )}
          {d.state === "published" && (
            <Button size="sm" variant="ghost" onClick={() => api.setFinished(e.id, false)} disabled={busy} title="Undo: back to draft">
              <RotateCcw size={13} />
            </Button>
          )}
          {e.postIds.length > 0 && (
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
