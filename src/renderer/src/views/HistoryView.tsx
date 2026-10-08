import { useEffect, useState } from "react";
import clsx from "clsx";
import { CalendarClock, Copy, Film, Images, RefreshCw, Send, Trash2, X } from "lucide-react";
import type { HistoryEntry, PostStatus } from "@shared/contract";
import { formatWhen, toLocalInput } from "@renderer/components/SchedulePicker";
import { Button, Card, Input } from "@renderer/components/ui";
import { describeTikTokError } from "@shared/tiktokErrors";
import { errorMessage, poster, timeAgo } from "@renderer/lib/api";

const STATUS: Record<PostStatus, { label: string; tone: string }> = {
  SCHEDULED: { label: "Scheduled", tone: "text-accent bg-accent/10" },
  CANCELLED: { label: "Cancelled", tone: "text-muted bg-sunken" },
  UPLOADING: { label: "Uploading", tone: "text-muted bg-sunken" },
  PROCESSING_UPLOAD: { label: "Processing", tone: "text-warn bg-warn/10" },
  PROCESSING_DOWNLOAD: { label: "TikTok is pulling images", tone: "text-warn bg-warn/10" },
  SEND_TO_USER_INBOX: { label: "In your TikTok inbox", tone: "text-cyan bg-cyan/10" },
  PUBLISH_COMPLETE: { label: "Posted", tone: "text-ok bg-ok/10" },
  FAILED: { label: "Failed", tone: "text-bad bg-bad/10" },
};


export function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void poster.listHistory().then(setEntries);
    return poster.onHistory((e) =>
      setEntries((cur) => (cur.some((x) => x.id === e.id) ? cur.map((x) => (x.id === e.id ? e : x)) : [e, ...cur])),
    );
  }, []);

  async function refresh(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await poster.refreshStatus(id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function act(id: string, work: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (entries.length === 0) {
    return (
      <Card className="py-16 text-center text-sm text-muted">Nothing posted yet. Your uploads show up here.</Card>
    );
  }

  const upcoming = entries
    .filter((e) => e.status === "SCHEDULED")
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const past = entries.filter((e) => e.status !== "SCHEDULED");

  const row = (e: HistoryEntry) => (
    <HistoryRow
      key={e.id}
      entry={e}
      busy={busyId === e.id}
      onRefresh={() => refresh(e.id)}
      onRemove={async () => {
        await poster.removeHistory(e.id);
        setEntries((cur) => cur.filter((x) => x.id !== e.id));
      }}
      onPostNow={() => act(e.id, () => poster.postScheduledNow(e.id))}
      onCancel={() => act(e.id, () => poster.cancelScheduled(e.id))}
      onReschedule={(at) => act(e.id, () => poster.reschedule(e.id, at))}
    />
  );

  return (
    <div className="space-y-6">
      {error && <p className="selectable text-sm text-bad">{error}</p>}
      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock size={15} className="text-accent" /> Scheduled · {upcoming.length}
          </h2>
          {upcoming.map(row)}
        </section>
      )}
      {past.length > 0 && (
        <section className="space-y-3">
          {upcoming.length > 0 && <h2 className="text-sm font-semibold">History</h2>}
          {past.map(row)}
        </section>
      )}
    </div>
  );
}

function inHowLong(iso: string): string {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (mins <= 0) return "any moment";
  if (mins < 60) return `in ${mins} min`;
  if (mins < 48 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ""}`.trim();
  return `in ${Math.round(mins / 1440)} days`;
}

function HistoryRow({
  entry: e,
  busy,
  onRefresh,
  onRemove,
  onPostNow,
  onCancel,
  onReschedule,
}: {
  entry: HistoryEntry;
  busy: boolean;
  onRefresh(): void;
  onRemove(): void;
  onPostNow(): void;
  onCancel(): void;
  onReschedule(at: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState("");
  const s = STATUS[e.status];
  const scheduled = e.status === "SCHEDULED";
  // A failed or missed scheduled post keeps its files, so it can still be sent or moved.
  const retryable = e.status === "FAILED" && e.hasJob;

  return (
    <Card className="space-y-3 p-3">
      <div className="flex items-center gap-4">
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-sunken">
          {e.thumbUrl && e.kind === "photo" ? (
            <img src={e.thumbUrl} alt="" className="size-full object-cover" onError={(ev) => (ev.currentTarget.style.display = "none")} />
          ) : (
            <div className="grid size-full place-items-center text-muted">
              {e.kind === "video" ? <Film size={22} /> : <Images size={22} />}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{e.label}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={clsx("rounded-full px-2 py-0.5 font-medium", s.tone)}>{s.label}</span>
            {scheduled && e.scheduledAt && (
              <span className="font-medium text-text">
                {formatWhen(e.scheduledAt)} <span className="font-normal text-muted">({inHowLong(e.scheduledAt)})</span>
              </span>
            )}
            <span>{e.kind === "video" ? "Video" : "Carousel"}</span>
            <span>·</span>
            <span>{e.mode === "DIRECT" ? "Direct post" : "Draft"}</span>
            {e.accountName && (
              <>
                <span>·</span>
                <span className="font-medium text-text">{e.accountName}</span>
              </>
            )}
            {!scheduled && (
              <>
                <span>·</span>
                <span>{e.scheduledAt ? `scheduled for ${formatWhen(e.scheduledAt)}` : timeAgo(e.createdAt)}</span>
              </>
            )}
          </div>
          {e.failReason && <p className="selectable text-xs text-bad">{describeTikTokError(e.failReason)}</p>}
          {e.postIds.length > 0 && (
            <button
              className="flex items-center gap-1 text-xs text-muted hover:text-text"
              onClick={() => navigator.clipboard.writeText(e.postIds[0])}
              title="Copy post ID"
            >
              <Copy size={12} /> Post ID {e.postIds[0]}
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {(scheduled || retryable) && (
            <>
              <Button size="sm" onClick={onPostNow} disabled={busy}>
                <Send size={13} /> {busy ? "Posting…" : "Post now"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setWhen(toLocalInput(new Date(e.scheduledAt && Date.parse(e.scheduledAt) > Date.now() ? e.scheduledAt : Date.now() + 3600_000)));
                  setEditing((v) => !v);
                }}
              >
                Reschedule
              </Button>
            </>
          )}
          {scheduled ? (
            <Button size="sm" variant="danger" onClick={onCancel} disabled={busy} title="Cancel this scheduled post">
              <X size={13} /> Cancel
            </Button>
          ) : (
            <>
              {e.publishId && (
                <Button variant="ghost" size="sm" onClick={onRefresh} disabled={busy} title="Refresh status">
                  <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
                </Button>
              )}
              <Button variant="ghost" size="sm" title="Remove from history" onClick={onRemove}>
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex items-center gap-2 pl-20">
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
              onReschedule(new Date(when).toISOString());
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
