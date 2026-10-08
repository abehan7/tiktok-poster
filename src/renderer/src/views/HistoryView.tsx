import { useEffect, useState } from "react";
import clsx from "clsx";
import { Copy, Film, Images, RefreshCw, Trash2 } from "lucide-react";
import type { HistoryEntry, PostStatus } from "@shared/contract";
import { Button, Card } from "@renderer/components/ui";
import { errorMessage, poster, timeAgo } from "@renderer/lib/api";

const STATUS: Record<PostStatus, { label: string; tone: string }> = {
  UPLOADING: { label: "Uploading", tone: "text-muted bg-sunken" },
  PROCESSING_UPLOAD: { label: "Processing", tone: "text-warn bg-warn/10" },
  PROCESSING_DOWNLOAD: { label: "TikTok is pulling images", tone: "text-warn bg-warn/10" },
  SEND_TO_USER_INBOX: { label: "In your TikTok inbox", tone: "text-cyan bg-cyan/10" },
  PUBLISH_COMPLETE: { label: "Posted", tone: "text-ok bg-ok/10" },
  FAILED: { label: "Failed", tone: "text-bad bg-bad/10" },
};

/** TikTok's fail_reason codes, in plain words. */
const FAIL_REASONS: Record<string, string> = {
  file_format_check_failed: "TikTok rejected the file format.",
  duration_check_failed: "The video is too long or too short for your account.",
  frame_rate_check_failed: "Frame rate must be 23–60 fps.",
  picture_size_check_failed: "Image or video dimensions aren't supported.",
  video_pull_failed: "TikTok couldn't download the video URL.",
  photo_pull_failed: "TikTok couldn't download the images. Is the R2 domain verified in the TikTok portal?",
  publish_cancelled: "The post was cancelled.",
  auth_removed: "The app's access was removed. Connect again.",
  spam_risk_too_many_posts: "TikTok's daily post limit for this account was hit.",
  spam_risk_user_banned_from_posting: "This account is currently blocked from posting.",
  spam_risk_text: "TikTok flagged the caption text.",
  spam_risk: "TikTok flagged this post as spam risk.",
  internal: "TikTok had an internal error. Try again.",
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

  if (entries.length === 0) {
    return (
      <Card className="py-16 text-center text-sm text-muted">Nothing posted yet. Your uploads show up here.</Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-bad">{error}</p>}
      {entries.map((e) => {
        const s = STATUS[e.status];
        return (
          <Card key={e.id} className="flex items-center gap-4 p-3">
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
                <span>{e.kind === "video" ? "Video" : "Carousel"}</span>
                <span>·</span>
                <span>{e.mode === "DIRECT" ? "Direct post" : "Draft"}</span>
                {e.accountName && (
                  <>
                    <span>·</span>
                    <span className="font-medium text-text">{e.accountName}</span>
                  </>
                )}
                <span>·</span>
                <span>{timeAgo(e.createdAt)}</span>
              </div>
              {e.failReason && (
                <p className="selectable text-xs text-bad">{FAIL_REASONS[e.failReason] ?? e.failReason}</p>
              )}
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
            <div className="flex shrink-0 gap-1">
              {e.publishId && (
                <Button variant="ghost" size="sm" onClick={() => refresh(e.id)} disabled={busyId === e.id} title="Refresh status">
                  <RefreshCw size={14} className={busyId === e.id ? "animate-spin" : ""} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                title="Remove from history"
                onClick={async () => {
                  await poster.removeHistory(e.id);
                  setEntries((cur) => cur.filter((x) => x.id !== e.id));
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
