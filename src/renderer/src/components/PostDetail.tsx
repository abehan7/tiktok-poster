import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Film, Images, X } from "lucide-react";
import type { HistoryEntry } from "@shared/contract";
import { describeTikTokError } from "@shared/tiktokErrors";
import { poster } from "@renderer/lib/api";
import { derive, lateText } from "@renderer/lib/post-state";
import { formatWhen } from "./SchedulePicker";
import { PRIVACY_LABELS } from "./PostOptions";

/** Full view of one post: slides or video, caption, and where/when it went. */
export function PostDetail({ entry: e, now, onClose }: { entry: HistoryEntry; now: number; onClose(): void }) {
  const c = e.content;
  const images = c?.images ?? [];
  const [index, setIndex] = useState(c?.coverIndex ?? 0);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const d = derive(e, now);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
      if (ev.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (ev.key === "ArrowRight") setIndex((i) => Math.min(images.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  const caption = [c?.title, c?.description].filter(Boolean).join("\n\n");

  return (
    <div
      className="no-drag fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={e.label}
    >
      <div className="flex max-h-full w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        {/* Media */}
        <div className="flex w-[46%] min-w-72 flex-col bg-black">
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {c?.video ? (
              <video src={c.video} controls className="max-h-[78vh] w-full" onError={(ev) => (ev.currentTarget.poster = "")} />
            ) : images.length > 0 ? (
              <>
                {broken.has(images[index]) ? (
                  <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-white/50">
                    <Images size={32} />
                    This image is no longer available (the copy was removed or the link expired).
                  </div>
                ) : (
                  <img
                    src={images[index]}
                    alt={`Slide ${index + 1}`}
                    className="max-h-[78vh] w-full object-contain"
                    draggable={false}
                    onError={() => setBroken((b) => new Set(b).add(images[index]))}
                  />
                )}
                {index > 0 && (
                  <NavButton side="left" onClick={() => setIndex(index - 1)} />
                )}
                {index < images.length - 1 && (
                  <NavButton side="right" onClick={() => setIndex(index + 1)} />
                )}
                <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
                  {index + 1} / {images.length}
                  {index === c?.coverIndex && " · Cover"}
                </span>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-white/50">
                {e.kind === "video" ? <Film size={32} /> : <Images size={32} />}
                {c ? "The media files are no longer on this Mac." : "This post was made before contents were saved."}
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto p-2">
              {images.map((src, i) => (
                <button
                  key={src}
                  onClick={() => setIndex(i)}
                  className={clsx(
                    "h-14 w-11 shrink-0 overflow-hidden rounded-md ring-2",
                    i === index ? "ring-accent" : "ring-transparent opacity-60 hover:opacity-100",
                  )}
                  aria-label={`Show slide ${i + 1}`}
                >
                  <img src={src} alt="" className="size-full object-cover" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold">{e.label}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className={clsx("rounded-full px-2 py-0.5 font-medium", d.tone)}>{d.label}</span>
                {d.lateMin !== null && <span className="text-warn">{lateText(d.lateMin)}</span>}
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-text" aria-label="Close">
              <X size={18} />
            </button>
          </header>

          <div className="selectable min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {e.failReason && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{describeTikTokError(e.failReason)}</p>}

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <Row label="Account">{e.accountName ?? "—"}</Row>
              <Row label="Type">
                {e.kind === "video" ? "Video" : `Carousel · ${images.length || "?"} slides`} ·{" "}
                {e.mode === "DIRECT" ? "Direct post" : "Draft to inbox"}
              </Row>
              {c?.privacyLevel && <Row label="Who can view">{PRIVACY_LABELS[c.privacyLevel]}</Row>}
              {e.kind === "photo" && e.mode === "DIRECT" && <Row label="Music">{c?.autoAddMusic ? "Auto (TikTok picks)" : "None"}</Row>}
              {e.scheduledAt && <Row label="Scheduled for">{formatWhen(e.scheduledAt)}</Row>}
              {e.sentAt && <Row label="Sent">{formatWhen(e.sentAt)}</Row>}
              {!e.scheduledAt && !e.sentAt && <Row label="Created">{formatWhen(e.createdAt)}</Row>}
              {e.finishedAt && <Row label="Marked published">{formatWhen(e.finishedAt)}</Row>}
              {e.publishId && (
                <Row label="Publish ID">
                  <span className="font-mono text-xs">{e.publishId}</span>
                </Row>
              )}
              {e.postIds[0] && (
                <Row label="Post ID">
                  <span className="font-mono text-xs">{e.postIds[0]}</span>
                </Row>
              )}
            </dl>

            {c && (c.title || c.description) && (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Caption</h3>
                  <div className="flex gap-1">
                    {c.title && c.description && <CopyButton text={c.title} label="Copy title" />}
                    <CopyButton text={c.description || c.title} label={c.description ? "Copy caption" : "Copy"} />
                  </div>
                </div>
                {c.title && c.description && <p className="text-sm font-semibold">{c.title}</p>}
                <p className="whitespace-pre-wrap rounded-lg bg-sunken px-3 py-2.5 text-sm leading-relaxed">
                  {c.description || c.title}
                </p>
              </section>
            )}
            {!caption && c && <p className="text-sm text-muted">No caption. Drafts are captioned in TikTok.</p>}

            {d.state === "draft" && (
              <p className="rounded-lg bg-cyan/10 px-3 py-2 text-sm text-cyan">
                Waiting in {e.accountName}'s TikTok inbox: open it in TikTok, add a sound, paste the caption, publish, then
                mark it published.
              </p>
            )}
          </div>

          {images.length > 0 && images[index]?.startsWith("https://") && (
            <footer className="border-t border-line px-5 py-3">
              <button
                onClick={() => poster.openExternal(images[index])}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-text"
              >
                <ExternalLink size={12} /> Open slide {index + 1} image
              </button>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick(): void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Previous slide" : "Next slide"}
      className={clsx(
        "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-1.5 text-white hover:bg-black/80",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon size={20} />
    </button>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:bg-sunken"
    >
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}
