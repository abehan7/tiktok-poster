import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, Plus } from "lucide-react";
import type { Appearance, SettingsUpdate, TestResult } from "@shared/contract";
import { Button, Card, Field, Input, Notice, Segmented, Toggle } from "@renderer/components/ui";
import { errorMessage, poster } from "@renderer/lib/api";
import { Avatar } from "@renderer/components/Avatar";
import { PlatformIcon } from "@renderer/components/Platform";
import { useAppState } from "@renderer/lib/app-state";

export function SettingsView() {
  const { settings, setSettings, reload } = useAppState();
  const [form, setForm] = useState<SettingsUpdate>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      clientKey: settings.clientKey,
      directPostEnabled: settings.directPostEnabled,
      oauthPort: settings.oauthPort,
      r2AccountId: settings.r2AccountId,
      r2AccessKeyId: settings.r2AccessKeyId,
      r2Bucket: settings.r2Bucket,
      r2PublicBaseUrl: settings.r2PublicBaseUrl,
      r2KeyPrefix: settings.r2KeyPrefix,
      carouselFolder: settings.carouselFolder,
      igAppId: settings.igAppId,
      igRedirectUri: settings.igRedirectUri,
    });
  }, [settings]);

  if (!settings) return null;
  const set = (patch: SettingsUpdate) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };
  const redirectUri = `http://127.0.0.1:${form.oauthPort ?? settings.oauthPort}/callback/`;

  async function save() {
    setError(null);
    try {
      const next = await poster.saveSettings(form);
      setSettings(next);
      setForm((f) => ({ ...f, clientSecret: "", r2SecretAccessKey: "", igAppSecret: "" }));
      setSaved(true);
      // Switching between mock and live changes which account is connected.
      if (next.mockMode !== settings!.mockMode || next.clientKey !== settings!.clientKey) await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    await save();
    try {
      setTest(await poster.testR2());
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <AccountsCard />
      <InstagramAccountsCard />

      <Card className="space-y-4">
        <Header
          title="TikTok app"
          link="https://developers.tiktok.com/apps"
          linkLabel="Developer portal"
          subtitle="Create an app, add Login Kit (Desktop) and Content Posting API, then paste its keys here."
        />
        {settings.mockMode && (
          <Notice tone="warn">Mock mode: no client key yet, so everything runs against a fake TikTok.</Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client key">
            <Input value={form.clientKey ?? ""} onChange={(e) => set({ clientKey: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Client secret" hint={settings.hasClientSecret ? "Saved. Leave blank to keep it." : undefined}>
            <Input
              type="password"
              value={form.clientSecret ?? ""}
              placeholder={settings.hasClientSecret ? "••••••••" : ""}
              onChange={(e) => set({ clientSecret: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Redirect URI"
          hint="Register this exact URI under Login Kit → Desktop in the portal. Change the port if it clashes."
        >
          <div className="flex gap-2">
            <Input readOnly value={redirectUri} className="selectable font-mono text-xs" />
            <div className="w-24 shrink-0">
              <Input
                type="number"
                value={form.oauthPort ?? ""}
                onChange={(e) => set({ oauthPort: Number(e.target.value) })}
                aria-label="OAuth port"
              />
            </div>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(redirectUri);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </div>
        </Field>
        <Toggle
          label="Direct Post is enabled for this app"
          hint="Requests the video.publish scope. Turn off if your app only has Upload (drafts). Reconnect after changing."
          checked={form.directPostEnabled ?? true}
          onChange={(v) => set({ directPostEnabled: v })}
        />
      </Card>

      <Card className="space-y-4">
        <Header
          title="Instagram app"
          link="https://developers.facebook.com/apps"
          linkLabel="Meta App Dashboard"
          subtitle="Only needed for “Log in”. Pasted tokens work without it. Create a Business app, add the Instagram use case (API setup with Instagram login), and copy its Instagram app ID and secret."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Instagram app ID">
            <Input value={form.igAppId ?? ""} onChange={(e) => set({ igAppId: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Instagram app secret" hint={settings.hasIgAppSecret ? "Saved. Leave blank to keep it." : undefined}>
            <Input
              type="password"
              value={form.igAppSecret ?? ""}
              placeholder={settings.hasIgAppSecret ? "••••••••" : ""}
              onChange={(e) => set({ igAppSecret: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Redirect URI"
          hint="Add this exact URI under Business login settings → OAuth redirect URIs. The login window catches it before it loads, so it doesn't have to be a real page."
        >
          <Input
            value={form.igRedirectUri ?? ""}
            onChange={(e) => set({ igRedirectUri: e.target.value })}
            className="selectable font-mono text-xs"
            spellCheck={false}
          />
        </Field>
      </Card>

      <Card className="space-y-4">
        <Header
          title="Cloudflare R2 (carousel images, Reels)"
          link="https://dash.cloudflare.com/?to=/:account/r2/overview"
          linkLabel="R2 dashboard"
          subtitle="TikTok and Instagram pull photos (and Instagram pulls Reels) from a public URL. For TikTok, verify the domain or URL prefix in the TikTok portal."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account ID">
            <Input value={form.r2AccountId ?? ""} onChange={(e) => set({ r2AccountId: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Bucket">
            <Input value={form.r2Bucket ?? ""} onChange={(e) => set({ r2Bucket: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Access key ID">
            <Input value={form.r2AccessKeyId ?? ""} onChange={(e) => set({ r2AccessKeyId: e.target.value })} spellCheck={false} />
          </Field>
          <Field label="Secret access key" hint={settings.hasR2SecretAccessKey ? "Saved. Leave blank to keep it." : undefined}>
            <Input
              type="password"
              value={form.r2SecretAccessKey ?? ""}
              placeholder={settings.hasR2SecretAccessKey ? "••••••••" : ""}
              onChange={(e) => set({ r2SecretAccessKey: e.target.value })}
            />
          </Field>
          <Field label="Public base URL" hint="The bucket's custom domain, e.g. https://media.yourdomain.com">
            <Input
              value={form.r2PublicBaseUrl ?? ""}
              onChange={(e) => set({ r2PublicBaseUrl: e.target.value })}
              placeholder="https://"
              spellCheck={false}
            />
          </Field>
          <Field label="Key prefix" hint="Objects go under this folder.">
            <Input value={form.r2KeyPrefix ?? ""} onChange={(e) => set({ r2KeyPrefix: e.target.value })} spellCheck={false} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={runTest} disabled={testing}>
            {testing ? "Testing…" : "Save & test R2"}
          </Button>
          {test && <span className={`selectable text-xs ${test.ok ? "text-ok" : "text-bad"}`}>{test.message}</span>}
        </div>
      </Card>

      <Card className="space-y-4">
        <Header title="Carousel renders" subtitle="Where “Load render folder…” starts browsing." />
        <Field label="Folder">
          <Input value={form.carouselFolder ?? ""} onChange={(e) => set({ carouselFolder: e.target.value })} spellCheck={false} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <Header title="Appearance" subtitle="System follows macOS light/dark mode. Applies immediately." />
        <Segmented<Appearance>
          value={settings.appearance}
          onChange={async (appearance) => setSettings(await poster.saveSettings({ appearance }))}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Card>

      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex items-center justify-end gap-3 pb-2">
        {saved && <span className="text-xs text-ok">Saved</span>}
        <Button variant="primary" onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

function Header({ title, subtitle, link, linkLabel }: { title: string; subtitle: string; link?: string; linkLabel?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>
      </div>
      {link && (
        <Button variant="ghost" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => poster.openExternal(link)}>
          {linkLabel} <ExternalLink size={12} />
        </Button>
      )}
    </div>
  );
}

/** Connected TikTok accounts, each with a hand-typed login email/ID so none get forgotten. */
function AccountsCard() {
  const { accounts, account: active, connecting, addAccount, cancelAdd, disconnect, setAccounts, selectAccount } = useAppState();

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <PlatformIcon platform="tiktok" size={16} /> TikTok accounts
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            TikTok doesn't share account emails with apps, so type which email or ID each account logs in with.
            To add another account, sign in to it in your browser first. Sandbox apps also need it under Target Users.
          </p>
        </div>
        {connecting ? (
          <Button size="sm" onClick={cancelAdd} className="shrink-0 whitespace-nowrap">
            Cancel login
          </Button>
        ) : (
          <Button size="sm" onClick={() => void addAccount()} className="shrink-0 whitespace-nowrap">
            <Plus size={14} /> Add account
          </Button>
        )}
      </div>

      {accounts.length === 0 ? (
        <p className="rounded-lg bg-sunken px-3 py-4 text-center text-sm text-muted">No accounts connected yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {accounts.map((a) => (
            <AccountRow
              key={a.openId}
              name={a.displayName}
              handle={`${a.username ? `@${a.username}` : "@handle unavailable"} · connected ${new Date(a.connectedAt).toLocaleDateString()}`}
              id={a.openId}
              avatarUrl={a.avatarUrl}
              note={a.note}
              problem={a.loginProblem}
              reconnect={{ label: "Reconnect", onClick: () => void addAccount() }}
              active={a.openId === active?.openId}
              onSelect={() => selectAccount(a.openId)}
              onDisconnect={() => disconnect(a.openId)}
              onSaveLogin={async (login) => setAccounts(await poster.setAccountNote(a.openId, login))}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AccountRow({
  name,
  handle,
  id,
  avatarUrl,
  note,
  problem,
  reconnect,
  active,
  onSelect,
  onDisconnect,
  onSaveLogin,
}: {
  name: string;
  /** Second line, e.g. "@handle · connected 10/8/2026". */
  handle: string;
  id: string;
  avatarUrl: string | null;
  note: string;
  /** Why the saved login no longer works, if it doesn't. */
  problem: string | null;
  reconnect: { label: string; onClick(): void };
  active: boolean;
  onSelect(): void;
  onDisconnect(): Promise<void>;
  onSaveLogin(login: string): Promise<void>;
}) {
  const [login, setLogin] = useState(note);
  const [saved, setSaved] = useState(false);
  useEffect(() => setLogin(note), [note]);

  async function commit() {
    if (login.trim() === note) return;
    await onSaveLogin(login);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <li className="space-y-3 p-3">
      <div className="flex items-center gap-3">
        <Avatar account={{ avatarUrl }} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {name}
            {active && (
              <span className="rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold text-accent">POSTING</span>
            )}
            {problem && <span className="rounded-full bg-bad/15 px-1.5 text-[10px] font-semibold text-bad">LOGIN DEAD</span>}
          </p>
          <p className="truncate text-xs text-muted">{handle}</p>
          <p className="selectable truncate font-mono text-[10px] text-muted/70" title="Account ID for this app">
            {id}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {problem && (
            <Button size="sm" variant="primary" onClick={reconnect.onClick}>
              {reconnect.label}
            </Button>
          )}
          {!active && (
            <Button size="sm" variant="ghost" onClick={onSelect}>
              Post as this
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => void onDisconnect()}>
            Disconnect
          </Button>
        </div>
      </div>
      {problem && (
        <p className="ml-[52px] rounded-lg bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">
          {problem} Scheduled posts for this account will fail until it's reconnected.
        </p>
      )}
      <div className="flex items-center gap-3 pl-[52px]">
        <span className="w-28 shrink-0 text-xs text-muted">Login email / ID</span>
        <Input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="e.g. me@gmail.com, or “Google login”"
          aria-label={`Login email or ID for ${name}`}
          className={!note ? "border-warn/60" : undefined}
        />
        <span className="w-16 shrink-0 text-[11px]">
          {saved ? <span className="text-ok">Saved</span> : !note ? <span className="text-warn">Not set</span> : null}
        </span>
      </div>
    </li>
  );
}

/** Connected Instagram professional accounts. */
function InstagramAccountsCard() {
  const { igAccounts, igAccount: active, igConnecting, igError, addIgAccount, addIgToken, disconnectIg, setIgAccounts, selectIgAccount } =
    useAppState();
  const [pasting, setPasting] = useState(false);
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

  async function addToken() {
    setAdding(true);
    setPasteError(null);
    try {
      await addIgToken(token);
      setToken("");
      setPasting(false);
    } catch (err) {
      setPasteError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <PlatformIcon platform="instagram" size={16} /> Instagram accounts
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Professional (Creator or Business) accounts only. Log in (needs the Instagram app keys below), or paste a token
            from the Meta App Dashboard. Tokens last 60 days and renew themselves while you use the app.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => setPasting((v) => !v)} className="whitespace-nowrap">
            <KeyRound size={14} /> Paste token
          </Button>
          <Button size="sm" onClick={() => void addIgAccount()} disabled={igConnecting} className="whitespace-nowrap">
            <Plus size={14} /> {igConnecting ? "Waiting for login…" : "Log in"}
          </Button>
        </div>
      </div>

      {pasting && (
        <div className="space-y-2 rounded-lg bg-sunken p-3">
          <div className="flex gap-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && token && void addToken()}
              placeholder="IGAA…"
              aria-label="Instagram access token"
              autoFocus
            />
            <Button variant="primary" onClick={() => void addToken()} disabled={!token || adding}>
              {adding ? "Checking…" : "Add"}
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            In the Meta App Dashboard: your app → Instagram → API setup with Instagram login → Generate access tokens → Add
            account, then Generate token.
          </p>
          {pasteError && <Notice tone="bad">{pasteError}</Notice>}
        </div>
      )}
      {igError && <Notice tone="bad">{igError}</Notice>}

      {igAccounts.length === 0 ? (
        <p className="rounded-lg bg-sunken px-3 py-4 text-center text-sm text-muted">No Instagram accounts connected yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {igAccounts.map((a) => (
            <AccountRow
              key={a.id}
              name={a.displayName}
              handle={`@${a.username} · ${a.accountType === "BUSINESS" ? "Business" : "Creator"} · ${a.loginProblem ? "token refused by Instagram" : `token good until ${new Date(a.expiresAt).toLocaleDateString()}`}`}
              id={a.id}
              avatarUrl={a.avatarUrl}
              note={a.note}
              problem={a.loginProblem}
              reconnect={{ label: "Paste new token", onClick: () => setPasting(true) }}
              active={a.id === active?.id}
              onSelect={() => selectIgAccount(a.id)}
              onDisconnect={() => disconnectIg(a.id)}
              onSaveLogin={async (login) => setIgAccounts(await poster.setIgAccountNote(a.id, login))}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
