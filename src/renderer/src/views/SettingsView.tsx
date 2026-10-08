import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { Appearance, SettingsUpdate, TestResult } from "@shared/contract";
import { Button, Card, Field, Input, Notice, Segmented, Toggle } from "@renderer/components/ui";
import { errorMessage, poster } from "@renderer/lib/api";
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
      setForm((f) => ({ ...f, clientSecret: "", r2SecretAccessKey: "" }));
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
          title="Cloudflare R2 (carousel images)"
          link="https://dash.cloudflare.com/?to=/:account/r2/overview"
          linkLabel="R2 dashboard"
          subtitle="TikTok pulls photos from a URL. Use a bucket with a custom domain, and verify that domain (or URL prefix) in the TikTok portal."
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
