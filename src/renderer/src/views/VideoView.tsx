import { useCallback, useRef, useState } from "react";
import { Film, ImagePlus, Send, X } from "lucide-react";
import type { CreatorInfo, LocalFile } from "@shared/contract";
import { DropZone } from "@renderer/components/DropZone";
import { NotConnected, PostModePicker, type ModeState } from "@renderer/components/PostOptions";
import { Button, Card, Field, Notice, ProgressBar, Textarea, Toggle } from "@renderer/components/ui";
import { errorMessage, formatBytes, poster } from "@renderer/lib/api";
import { useAppState } from "@renderer/lib/app-state";
import { useProgress } from "@renderer/lib/use-progress";

export function VideoView({ onPosted }: { onPosted(): void }) {
  const { account } = useAppState();
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progress = useProgress(busy);
  const onModeChange = useCallback((v: ModeState) => setMode(v), []);

  const direct = mode.mode === "DIRECT";
  const tooLong = Boolean(direct && creator && duration && duration > creator.maxVideoPostDurationSec);
  const ready = Boolean(account && file && (!direct || mode.privacyLevel) && title.length <= 2200 && !tooLong);

  async function submit() {
    if (!file || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await poster.postVideo({
        filePath: file.path,
        mode: mode.mode,
        title,
        privacyLevel: mode.privacyLevel || "SELF_ONLY",
        disableComment: !allowComment,
        disableDuet: !allowDuet,
        disableStitch: !allowStitch,
        coverTimestampMs: coverMs,
        isAigc,
      });
      setFile(null);
      setTitle("");
      onPosted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

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
            {direct && (
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
        {!account && <NotConnected />}
        <PostModePicker value={mode} onChange={onModeChange} onCreatorInfo={setCreator} />

        {direct && (
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

        {error && <Notice tone="bad">{error}</Notice>}
        {busy && progress && <ProgressBar stage={progress.stage} fraction={progress.fraction} />}

        <div className="flex justify-end">
          <Button variant="primary" size="lg" disabled={!ready || busy} onClick={submit}>
            <Send size={16} /> {busy ? "Uploading…" : direct ? "Post to TikTok" : "Send to TikTok inbox"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
