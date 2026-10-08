import { useEffect, useState } from "react";
import type { CreatorInfo, PostMode, PrivacyLevel } from "@shared/contract";
import { errorMessage, poster } from "@renderer/lib/api";
import { useAppState } from "@renderer/lib/app-state";
import { Field, Notice, Segmented } from "./ui";

export const PRIVACY_LABELS: Record<PrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export interface ModeState {
  mode: PostMode;
  privacyLevel: PrivacyLevel | "";
}

/**
 * Draft vs direct post. For direct posts TikTok requires the privacy options
 * from creator_info, picked by the user (no default).
 */
export function PostModePicker({
  value,
  onChange,
  onCreatorInfo,
}: {
  value: ModeState;
  onChange(v: ModeState): void;
  onCreatorInfo?(info: CreatorInfo | null): void;
}) {
  const { canDirectPost, settings, accounts, account, selectAccount } = useAppState();
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openId = account?.openId;

  useEffect(() => {
    if (!canDirectPost && value.mode === "DIRECT") onChange({ mode: "DRAFT", privacyLevel: "" });
  }, [canDirectPost, value.mode, onChange]);

  // Privacy options are per account: re-fetch and re-pick when the account changes.
  useEffect(() => {
    setCreator(null);
    onCreatorInfo?.(null);
    if (value.mode !== "DIRECT" || !openId) return;
    onChange({ ...value, privacyLevel: "" });
    let live = true;
    setError(null);
    poster
      .getCreatorInfo(openId)
      .then((info) => {
        if (!live) return;
        setCreator(info);
        onCreatorInfo?.(info);
      })
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.mode, openId]);

  return (
    <div className="space-y-4">
      {account && (
        <Field
          label="Post as"
          hint={account.note ? `Logs in with ${account.note}` : "Set this account's login email / ID in Settings"}
        >
          <select
            value={account.openId}
            onChange={(e) => selectAccount(e.target.value)}
            className="h-9 w-full rounded-lg border border-line bg-sunken px-3 text-sm outline-none focus:border-cyan"
          >
            {accounts.map((a) => (
              <option key={a.openId} value={a.openId}>
                {a.displayName}
                {a.username ? ` (@${a.username})` : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="flex items-center justify-between gap-4">
        <Segmented
          value={value.mode}
          onChange={(mode) => onChange({ mode, privacyLevel: "" })}
          options={[
            { value: "DRAFT", label: "Draft to inbox" },
            { value: "DIRECT", label: "Direct post", disabled: !canDirectPost },
          ]}
        />
      </div>

      {value.mode === "DRAFT" ? (
        <Notice>
          TikTok sends this to your app's inbox. Open TikTok, tap the notification, then finish the caption, sound
          and privacy there. Works before your app passes TikTok's audit.
        </Notice>
      ) : (
        <>
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Who can view">
            <div className="flex flex-wrap gap-1.5">
              {(creator?.privacyLevelOptions ?? []).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onChange({ ...value, privacyLevel: p })}
                  className={
                    "h-8 rounded-full border px-3 text-sm " +
                    (value.privacyLevel === p
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line hover:bg-sunken")
                  }
                >
                  {PRIVACY_LABELS[p]}
                </button>
              ))}
              {!creator && !error && <span className="text-xs text-muted">Loading your account's options…</span>}
            </div>
          </Field>
          {!settings?.mockMode && (
            <Notice tone="warn">
              Until TikTok audits this app, Direct Post only works when the TikTok account itself is set to Private. For a public account, use Draft to inbox.
            </Notice>
          )}
        </>
      )}
    </div>
  );
}

export function NotConnected() {
  return (
    <Notice tone="warn">Connect your TikTok account (top right) before posting.</Notice>
  );
}
