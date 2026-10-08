import { useState } from "react";
import clsx from "clsx";
import { Film, History, Images, LogOut, Settings, UserRound } from "lucide-react";
import { Button } from "./components/ui";
import { errorMessage, poster } from "./lib/api";
import { AppStateProvider, useAppState } from "./lib/app-state";
import { CarouselView } from "./views/CarouselView";
import { HistoryView } from "./views/HistoryView";
import { SettingsView } from "./views/SettingsView";
import { VideoView } from "./views/VideoView";

type Tab = "video" | "carousel" | "history" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Film; title: string }[] = [
  { id: "carousel", label: "Carousel", icon: Images, title: "New photo carousel" },
  { id: "video", label: "Video", icon: Film, title: "New video" },
  { id: "history", label: "History", icon: History, title: "History" },
  { id: "settings", label: "Settings", icon: Settings, title: "Settings" },
];

export function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("carousel");
  const { settings } = useAppState();
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-full">
      <aside className="drag flex w-52 shrink-0 flex-col border-r border-line bg-panel px-3 pb-4 pt-12">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="grid size-7 place-items-center rounded-lg bg-text text-sm font-black text-bg">T</span>
          <span className="font-semibold">TikTok Poster</span>
        </div>
        <nav className="no-drag space-y-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
                tab === t.id ? "bg-sunken font-medium" : "text-muted hover:bg-sunken/60 hover:text-text",
              )}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </nav>
        {settings?.mockMode && (
          <button
            onClick={() => setTab("settings")}
            className="no-drag mt-auto rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-left text-xs leading-snug text-warn"
          >
            Mock mode. Add your TikTok keys in Settings to post for real.
          </button>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="drag flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
          <h1 className="text-[15px] font-semibold">{current.title}</h1>
          <AccountButton />
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {tab === "video" && <VideoView onPosted={() => setTab("history")} />}
          {tab === "carousel" && <CarouselView onPosted={() => setTab("history")} />}
          {tab === "history" && <HistoryView />}
          {tab === "settings" && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

function AccountButton() {
  const { account, accountError, setAccount, loading } = useAppState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      setAccount(await poster.connect());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  if (!account) {
    return (
      <div className="no-drag flex items-center gap-3">
        {(error ?? accountError) && (
          <span className="selectable max-w-80 truncate text-xs text-bad" title={error ?? accountError ?? ""}>
            {error ?? accountError}
          </span>
        )}
        <Button variant="primary" size="sm" onClick={connect} disabled={busy}>
          {busy ? "Waiting for browser…" : "Connect TikTok"}
        </Button>
      </div>
    );
  }

  return (
    <div className="no-drag flex items-center gap-2">
      {account.avatarUrl ? (
        <img src={account.avatarUrl} alt="" className="size-7 rounded-full" />
      ) : (
        <span className="grid size-7 place-items-center rounded-full bg-sunken text-muted">
          <UserRound size={15} />
        </span>
      )}
      <span className="text-sm font-medium">{account.displayName}</span>
      <Button
        variant="ghost"
        size="sm"
        title="Disconnect"
        onClick={async () => {
          await poster.disconnect();
          setAccount(null);
        }}
      >
        <LogOut size={14} />
      </Button>
    </div>
  );
}
