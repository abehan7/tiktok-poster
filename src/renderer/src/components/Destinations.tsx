import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";
import type { Platform } from "@shared/contract";
import { useAppState } from "@renderer/lib/app-state";
import { Field, Notice, Textarea } from "./ui";
import { PLATFORM_NAMES, PlatformIcon } from "./Platform";

export type Destinations = Record<Platform, boolean>;

const KEY = "tiktok-poster.destinations";

function read(): Destinations {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Destinations | null;
    if (v && (v.tiktok || v.instagram)) return { tiktok: Boolean(v.tiktok), instagram: Boolean(v.instagram) };
  } catch {
    // fall through to the default
  }
  return { tiktok: true, instagram: false };
}

/** Where new posts go; remembered across launches and shared by the Carousel and Video tabs. */
export function useDestinations(): [Destinations, (d: Destinations) => void] {
  const [dest, setDest] = useState<Destinations>(read);
  return [
    dest,
    (d) => {
      setDest(d);
      try {
        localStorage.setItem(KEY, JSON.stringify(d));
      } catch {
        // storage unavailable — choice just won't persist
      }
    },
  ];
}

/** "Post to" chips. At least one stays on. `sent` marks platforms already done after a partial failure. */
export function DestinationPicker({
  value,
  onChange,
  sent,
}: {
  value: Destinations;
  onChange(d: Destinations): void;
  sent: Partial<Destinations>;
}) {
  return (
    <Field label="Post to">
      <div className="flex flex-wrap gap-2">
        {(["tiktok", "instagram"] as const).map((p) => {
          const on = value[p];
          const onlyOne = on && !value[p === "tiktok" ? "instagram" : "tiktok"];
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              disabled={onlyOne}
              title={onlyOne ? "Pick at least one place to post" : undefined}
              onClick={() => onChange({ ...value, [p]: !on })}
              className={clsx(
                "flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors disabled:cursor-default",
                on ? (p === "instagram" ? "border-ig bg-ig/10" : "border-accent bg-accent/10") : "border-line text-muted hover:bg-sunken",
              )}
            >
              <PlatformIcon platform={p} className={on ? undefined : "text-muted"} />
              {PLATFORM_NAMES[p]}
              {sent[p] && (
                <span className="flex items-center gap-0.5 text-xs text-ok">
                  <Check size={12} /> sent
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/** Account, caption and limits for the Instagram half of a post. */
export function InstagramOptions({
  caption,
  onCaption,
  captionPlaceholder,
  fallbackCaption = "",
  children,
  notes,
}: {
  caption: string;
  onCaption(v: string): void;
  captionPlaceholder: string;
  /** What gets posted when the caption is left empty (counted for the limits). */
  fallbackCaption?: string;
  /** Extra toggles (e.g. share Reel to feed). */
  children?: ReactNode;
  /** Format notes for this kind of post. */
  notes?: ReactNode;
}) {
  const { igAccounts, igAccount, selectIgAccount } = useAppState();
  const effective = caption.trim() ? caption : fallbackCaption;
  const hashtags = (effective.match(/#[^\s#]+/g) ?? []).length;

  return (
    <section className="space-y-4 rounded-xl border border-ig/30 bg-ig/[0.04] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <PlatformIcon platform="instagram" size={16} /> Instagram
      </h3>
      {!igAccount ? (
        <Notice tone="warn">Connect an Instagram professional account in Settings first.</Notice>
      ) : (
        <Field label="Post as" hint={igAccount.note ? `Logs in with ${igAccount.note}` : undefined}>
          <select
            value={igAccount.id}
            onChange={(e) => selectIgAccount(e.target.value)}
            className="h-9 w-full rounded-lg border border-line bg-sunken px-3 text-sm outline-none focus:border-cyan"
          >
            {igAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username}
                {a.displayName !== a.username ? ` (${a.displayName})` : ""}
                {a.loginProblem ? " · login dead" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      {igAccount?.loginProblem && (
        <Notice tone="bad">
          {igAccount.loginProblem} Posting to @{igAccount.username} will fail until you paste a new token in Settings.
        </Notice>
      )}
      <Notice>
        Instagram's API has no drafts, so this publishes publicly to {igAccount ? `@${igAccount.username}` : "the account"} as
        soon as it's sent (or at the scheduled time).
        {notes}
      </Notice>
      <Field
        label="Caption"
        counter={{ value: effective.length, max: 2200 }}
        hint={hashtags > 30 ? <span className="text-bad">{hashtags} hashtags. Instagram allows 30.</span> : `${hashtags}/30 hashtags`}
      >
        <Textarea rows={4} value={caption} onChange={(e) => onCaption(e.target.value)} placeholder={captionPlaceholder} />
      </Field>
      {children}
    </section>
  );
}

/** Instagram caption problems that block posting. */
export function igCaptionOk(caption: string): boolean {
  return caption.length <= 2200 && (caption.match(/#[^\s#]+/g) ?? []).length <= 30;
}
