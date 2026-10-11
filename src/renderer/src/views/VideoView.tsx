import { useCallback, useRef, useState } from "react";
import { Film, ImagePlus, Send, X } from "lucide-react";
import type { CreatorInfo, LocalFile } from "@shared/contract";
import { DestinationPicker, igCaptionOk, InstagramOptions, useDestinations, type Destinations } from "@renderer/components/Destinations";
import { DropZone } from "@renderer/components/DropZone";
import { NotConnected, PostModePicker, type ModeState } from "@renderer/components/PostOptions";
import { Button, Card, Field, Notice, ProgressBar, Textarea, Toggle } from "@renderer/components/ui";
import { errorMessage, formatBytes, poster } from "@renderer/lib/api";
import { useAppState } from "@renderer/lib/app-state";
import { formatWhen, SchedulePicker, scheduleOk } from "@renderer/components/SchedulePicker";
import { useProgress } from "@renderer/lib/use-progress";

export function VideoView({ onPosted }: { onPosted(): void }) {
  const { account, igAccount } = useAppState();
  const [dest, setDest] = useDestinations();
  const [sent, setSent] = useState<Partial<Destinations>>({});
  const [igCaption, setIgCaption] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [file, setFile] = useState<LocalFile | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [mode, setMode] = useState<ModeState>({ mode: "DRAFT", privacyLevel: "" });
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [title, setTitle] = useState("");
  const [coverMs, setCoverMs] = useState(0);
  const [allowComment, setAllowComment] = useState(true);
  const [allowDuet, setAllowDuet] = useState(true);
  const [allowStitch, setAllowStitch] = useState(true);
  const [isAigc, setIsAigc] = useState(false);
  const [when, setWhen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progress = useProgress(busy);
  const onModeChange = useCallback((v: ModeState) => setMode(v), []);

  const direct = mode.mode === "DIRECT";
  const toTikTok = dest.tiktok && !sent.tiktok;
  const toInstagram = dest.instagram && !sent.instagram;
  const tooLong = Boolean(toTikTok && direct && creator && duration && duration > creator.maxVideoPostDurationSec);
  const reelProblem = !toInstagram || !file ? null : reelIssue(file, duration);
  const reelCaption = igCaption.trim() ? igCaption : direct ? title : "";
  const ready = Boolean(
    scheduleOk(when) &&
      file &&
      (toTikTok || toInstagram) &&
      (!toTikTok || (account && (!direct || mode.privacyLevel) && title.length <= 2200 && !tooLong)) &&
      (!toInstagram || (igAccount && igCaptionOk(reelCaption) && !reelProblem)),
  );

  async function submit() {
    if (!file || !ready) return;
    setBusy(true);
    setError(null);
    const at = when ? new Date(when).toISOString() : null;
    const failures: string[] = [];
    const done = { ...sent };
    if (toTikTok) {
      try {
        const input = {
          openId: account!.openId,
          filePath: file.path,
          mode: mode.mode,
          title,
          privacyLevel: mode.privacyLevel || "SELF_ONLY",
          disableComment: !allowComment,
          disableDuet: !allowDuet,
          disableStitch: !allowStitch,
          coverTimestampMs: coverMs,
          isAigc,
        };
        if (at) await poster.scheduleVideo(input, at);
        else await poster.postVideo(input);
        done.tiktok = true;
      } catch (err) {
        failures.push(`TikTok: ${errorMessage(err)}`);
      }
    }
    if (toInstagram) {
      try {
        const input = { igUserId: igAccount!.id, filePath: file.path, caption: reelCaption, coverTimestampMs: coverMs, shareToFeed };
        if (at) await poster.scheduleIgVideo(input, at);
        else await poster.postIgVideo(input);
        done.instagram = true;
      } catch (err) {
        failures.push(`Instagram: ${errorMessage(err)}`);
      }
    }
    setBusy(false);
    if (failures.length) {
      setSent(done);
      setError(failures.join("\n"));
      return;
    }
    setFile(null);
    setTitle("");
    setIgCaption("");
    setWhen(null);
    setSent({});
    onPosted();
  }

  const action = [
    toTikTok && (direct ? "Post to TikTok" : "Send to TikTok inbox"),
    toInstagram && (toTikTok ? "Instagram Reel" : "Post Instagram Reel"),
  ]
    .filter(Boolean)
    .join(" + ");

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card className="flex flex-col">
        {file ? (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                src={file.url}
                controls
                className="mx-auto max-h-[460px]"
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              />
              <button
                onClick={() => setFile(null)}
                className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                aria-label="Remove video"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 tabular-nums">
                {formatBytes(file.size)}
                {duration ? ` · ${duration.toFixed(1)}s` : ""}
              </span>
            </div>
            {((toTikTok && direct) || toInstagram) && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Cover frame: {(coverMs / 1000).toFixed(1)}s</span>
                <Button
                  size="sm"
                  onClick={() => setCoverMs(Math.round((videoRef.current?.currentTime ?? 0) * 1000))}
                >
                  <ImagePlus size={14} /> Use current frame
                </Button>
              </div>
            )}
            {reelProblem && <Notice tone="bad">{reelProblem}</Notice>}
            {tooLong && (
              <Notice tone="bad">
                Your account can post up to {creator!.maxVideoPostDurationSec}s; this video is {duration!.toFixed(0)}s.
              </Notice>
            )}
          </div>
        ) : (
          <DropZone
            onFiles={(f) => {
              const v = f.find((x) => /\.(mp4|mov|webm)$/i.test(x.name));
              if (v) {
                setFile(v);
                setCoverMs(0);
              }
            }}
            className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
          >
            <Film size={36} className="text-muted" />
            <p className="text-sm">Drop a video here</p>
            <p className="text-xs text-muted">MP4, MOV or WebM · up to 4 GB · 23–60 fps</p>
            <Button
              onClick={async () => {
                const v = await poster.pickVideo();
                if (v) {
                  setFile(v);
                  setCoverMs(0);
                }
              }}
            >
              Choose file…
            </Button>
          </DropZone>
        )}
      </Card>

      <Card className="space-y-5">
        <DestinationPicker value={dest} onChange={setDest} sent={sent} />
        <SchedulePicker value={when} onChange={setWhen} />

        {toTikTok && !account && <NotConnected />}
        {toTikTok && <PostModePicker value={mode} onChange={onModeChange} onCreatorInfo={setCreator} />}

        {toTikTok && direct && (
          <>
            <Field label="Caption" counter={{ value: title.length, max: 2200 }} hint="Hashtags and @mentions go here too.">
              <Textarea rows={5} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Say something…" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle
                label="Allow comments"
                checked={allowComment && !creator?.commentDisabled}
                disabled={creator?.commentDisabled}
                onChange={setAllowComment}
              />
              <Toggle
                label="Allow Duet"
                checked={allowDuet && !creator?.duetDisabled}
                disabled={creator?.duetDisabled}
                onChange={setAllowDuet}
              />
              <Toggle
                label="Allow Stitch"
                checked={allowStitch && !creator?.stitchDisabled}
                disabled={creator?.stitchDisabled}
                onChange={setAllowStitch}
              />
              <Toggle label="AI-generated content" hint="Adds TikTok's AIGC label" checked={isAigc} onChange={setIsAigc} />
            </div>
          </>
        )}

        {toInstagram && (
          <InstagramOptions
            caption={igCaption}
            onCaption={setIgCaption}
            fallbackCaption={toTikTok && direct ? title : ""}
            captionPlaceholder={toTikTok && direct && title ? "Leave empty to use the TikTok caption" : "Caption with #hashtags"}
            notes=" Posted as a Reel: MP4 or MOV, 3 seconds to 15 minutes, up to 300 MB. The cover frame is shared with TikTok."
          >
            <Toggle
              label="Also show in the main feed"
              hint="Off = Reels tab only"
              checked={shareToFeed}
              onChange={setShareToFeed}
            />
          </InstagramOptions>
        )}

        {error && <Notice tone="bad"><span className="whitespace-pre-line">{error}</span></Notice>}
        {busy && progress && <ProgressBar stage={progress.stage} fraction={progress.fraction} />}

        <div className="flex justify-end">
          <Button variant="primary" size="lg" disabled={!ready || busy} onClick={submit}>
            <Send size={16} /> {busy
              ? when ? "Scheduling…" : "Uploading…"
              : when
                ? `Schedule · ${formatWhen(new Date(when).toISOString())}`
                : action}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Why this file can't be a Reel, if it can't. */
function reelIssue(file: LocalFile, duration: number | null): string | null {
  if (!/\.(mp4|mov)$/i.test(file.name)) return "Instagram Reels must be MP4 or MOV.";
  if (file.size > 300 * 1024 * 1024) return "Instagram Reels can be at most 300 MB.";
  if (duration !== null && duration < 3) return "Instagram Reels must be at least 3 seconds long.";
  if (duration !== null && duration > 15 * 60) return "Instagram Reels can be at most 15 minutes long.";
  return null;
}
