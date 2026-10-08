import { useCallback, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, FolderOpen, ImagePlus, Images, Send, Star, X } from "lucide-react";
import type { LocalFile } from "@shared/contract";
import { DropZone } from "@renderer/components/DropZone";
import { NotConnected, PostModePicker, type ModeState } from "@renderer/components/PostOptions";
import { Button, Card, Field, Input, Notice, ProgressBar, Textarea, Toggle } from "@renderer/components/ui";
import { errorMessage, poster } from "@renderer/lib/api";
import { useAppState } from "@renderer/lib/app-state";
import { useProgress } from "@renderer/lib/use-progress";

const MAX_IMAGES = 35;
const isImage = (f: LocalFile) => /\.(png|jpe?g|webp)$/i.test(f.name);

export function CarouselView({ onPosted }: { onPosted(): void }) {
  const { account, settings } = useAppState();
  const [images, setImages] = useState<LocalFile[]>([]);
  const [cover, setCover] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeState>({ mode: "DRAFT", privacyLevel: "" });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [autoMusic, setAutoMusic] = useState(true);
  const [allowComment, setAllowComment] = useState(true);
  const [isAigc, setIsAigc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useProgress(busy);
  const onModeChange = useCallback((v: ModeState) => setMode(v), []);

  const direct = mode.mode === "DIRECT";
  const ready = Boolean(
    account &&
      images.length > 0 &&
      images.length <= MAX_IMAGES &&
      title.length <= 90 &&
      description.length <= 4000 &&
      (!direct || mode.privacyLevel),
  );

  const add = (files: LocalFile[]) => setImages((cur) => [...cur, ...files.filter(isImage)].slice(0, MAX_IMAGES));

  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    setImages(next);
    if (cover === i) setCover(j);
    else if (cover === j) setCover(i);
  }

  function remove(i: number) {
    setImages(images.filter((_, k) => k !== i));
    if (cover >= i && cover > 0) setCover(cover - 1);
  }

  async function loadFolder() {
    const folder = await poster.pickCarouselFolder();
    if (!folder) return;
    setImages(folder.images.slice(0, MAX_IMAGES));
    setCover(0);
    setSource(folder.path);
    if (folder.caption) setDescription(folder.caption);
  }

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await poster.postPhotos({
        filePaths: images.map((i) => i.path),
        mode: mode.mode,
        title,
        description,
        privacyLevel: mode.privacyLevel || "SELF_ONLY",
        coverIndex: cover,
        disableComment: !allowComment,
        autoAddMusic: autoMusic,
        isAigc,
      });
      setImages([]);
      setTitle("");
      setDescription("");
      setSource(null);
      onPosted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Slides</h2>
            <p className="text-xs text-muted">
              {images.length}/{MAX_IMAGES} · converted to JPEG (≤1080p) and hosted on R2 for TikTok to pull
              {source && <> · from {source.split("/").slice(-2).join("/")}</>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={loadFolder} title={settings?.carouselFolder}>
              <FolderOpen size={15} /> Load render folder…
            </Button>
            <Button onClick={async () => add(await poster.pickImages())}>
              <ImagePlus size={15} /> Add images…
            </Button>
          </div>
        </div>

        <DropZone onFiles={add} className={clsx("p-3", images.length === 0 && "py-14")}>
          {images.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <Images size={36} className="text-muted" />
              <p className="text-sm">Drop images here, or load a tubelingo-carousel render folder</p>
              <p className="text-xs text-muted">PNG, JPG or WebP · the folder's caption.txt fills the description</p>
            </div>
          ) : (
            <ol className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {images.map((img, i) => (
                <li key={img.path + i} className="group relative">
                  <div
                    className={clsx(
                      "relative aspect-[3/4] overflow-hidden rounded-lg bg-sunken ring-2",
                      cover === i ? "ring-accent" : "ring-transparent",
                    )}
                  >
                    <img src={img.url} alt={img.name} className="size-full object-cover" draggable={false} />
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 text-xs font-semibold text-white tabular-nums">
                      {i + 1}
                    </span>
                    {cover === i && (
                      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-accent px-1.5 text-[11px] font-semibold text-white">
                        Cover
                      </span>
                    )}
                    <div className="absolute inset-x-0 top-0 flex justify-end gap-1 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconBtn label="Set as cover" onClick={() => setCover(i)}>
                        <Star size={13} />
                      </IconBtn>
                      <IconBtn label="Remove" onClick={() => remove(i)}>
                        <X size={13} />
                      </IconBtn>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconBtn label="Move left" onClick={() => move(i, -1)}>
                        <ChevronLeft size={13} />
                      </IconBtn>
                      <IconBtn label="Move right" onClick={() => move(i, 1)}>
                        <ChevronRight size={13} />
                      </IconBtn>
                    </div>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted">{img.name}</p>
                </li>
              ))}
            </ol>
          )}
        </DropZone>
      </Card>

      <Card className="space-y-5">
        {!account && <NotConnected />}
        <PostModePicker value={mode} onChange={onModeChange} />

        <Field label="Title" counter={{ value: title.length, max: 90 }} hint="Shown in bold above the description.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Description" counter={{ value: description.length, max: 4000 }} hint="Caption with #hashtags.">
          <Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          {direct && (
            <>
              <Toggle label="Auto-add music" hint="TikTok picks a recommended sound" checked={autoMusic} onChange={setAutoMusic} />
              <Toggle label="Allow comments" checked={allowComment} onChange={setAllowComment} />
            </>
          )}
          <Toggle label="AI-generated content" hint="Adds TikTok's AIGC label" checked={isAigc} onChange={setIsAigc} />
        </div>

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

function IconBtn({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md bg-black/65 p-1 text-white hover:bg-black/85"
    >
      {children}
    </button>
  );
}
