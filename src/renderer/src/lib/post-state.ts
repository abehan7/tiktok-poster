import type { HistoryEntry } from "@shared/contract";

export type PostState =
  | "upcoming"
  | "delayed"
  | "sending"
  | "draft"
  | "published"
  | "posted"
  | "failed"
  | "missed"
  | "cancelled";

export interface DerivedState {
  state: PostState;
  label: string;
  /** Pill classes. */
  tone: string;
  /** Dot / chip accent classes. */
  dot: string;
  /** When the post belongs on the calendar. */
  when: Date;
  /** Minutes a scheduled post went out after its slot (null if on time or not scheduled). */
  lateMin: number | null;
}

/** A scheduled post not sent this long after its slot counts as delayed. */
const DELAY_GRACE_MS = 2 * 60_000;
/** Going out more than this after the slot gets a "late" note. */
const LATE_NOTE_MIN = 5;

const STYLE: Record<PostState, { label: string; tone: string; dot: string }> = {
  upcoming: { label: "Scheduled", tone: "text-sched bg-sched/15", dot: "bg-sched" },
  delayed: { label: "Delayed", tone: "text-warn bg-warn/15", dot: "bg-warn" },
  sending: { label: "Sending", tone: "text-warn bg-warn/10", dot: "bg-warn/70" },
  draft: { label: "Draft ready", tone: "text-cyan bg-cyan/10", dot: "bg-cyan" },
  published: { label: "Published", tone: "text-ok bg-ok/10", dot: "bg-ok" },
  posted: { label: "Posted", tone: "text-ok bg-ok/10", dot: "bg-ok" },
  failed: { label: "Failed", tone: "text-bad bg-bad/10", dot: "bg-bad" },
  missed: { label: "Missed", tone: "text-bad bg-bad/10", dot: "bg-bad" },
  cancelled: { label: "Cancelled", tone: "text-muted bg-sunken", dot: "bg-muted/50" },
};

export function derive(e: HistoryEntry, now = Date.now()): DerivedState {
  const when = new Date(e.scheduledAt ?? e.sentAt ?? e.createdAt);
  let state: PostState;
  switch (e.status) {
    case "SCHEDULED":
      state = when.getTime() + DELAY_GRACE_MS < now ? "delayed" : "upcoming";
      break;
    case "CANCELLED":
      state = "cancelled";
      break;
    case "FAILED":
      state = e.failReason?.startsWith("Missed") ? "missed" : "failed";
      break;
    case "SEND_TO_USER_INBOX":
      state = e.finishedAt ? "published" : "draft";
      break;
    case "PUBLISH_COMPLETE":
      state = "posted";
      break;
    default:
      state = "sending";
  }
  let lateMin: number | null = null;
  if (e.scheduledAt && e.sentAt) {
    const m = Math.round((Date.parse(e.sentAt) - Date.parse(e.scheduledAt)) / 60_000);
    if (m >= LATE_NOTE_MIN) lateMin = m;
  }
  return { state, ...STYLE[state], when, lateMin };
}

export function lateText(min: number): string {
  return min < 60 ? `went out ${min}m late` : `went out ${Math.floor(min / 60)}h ${min % 60}m late`;
}

/** States that need a decision from the user. */
export const ATTENTION: PostState[] = ["delayed", "draft", "failed", "missed"];
