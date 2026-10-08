import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Account, SettingsView } from "@shared/contract";
import { errorMessage, poster } from "./api";

interface AppState {
  settings: SettingsView | null;
  account: Account | null;
  accountError: string | null;
  loading: boolean;
  /** Direct post is possible: enabled in settings and the token carries video.publish. */
  canDirectPost: boolean;
  reload(): Promise<void>;
  setSettings(s: SettingsView): void;
  setAccount(a: Account | null): void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setSettings(await poster.getSettings());
    try {
      setAccount(await poster.getAccount());
      setAccountError(null);
    } catch (err) {
      setAccount(null);
      setAccountError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canDirectPost = Boolean(settings?.directPostEnabled && account?.scopes.includes("video.publish"));

  return (
    <Ctx.Provider
      value={{ settings, account, accountError, loading, canDirectPost, reload, setSettings, setAccount }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside provider");
  return v;
}
