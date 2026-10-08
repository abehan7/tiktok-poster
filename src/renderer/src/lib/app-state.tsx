import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Account, SettingsView } from "@shared/contract";
import { errorMessage, poster } from "./api";

const ACTIVE_KEY = "tiktok-poster.activeAccount";

interface AppState {
  settings: SettingsView | null;
  accounts: Account[];
  /** The account new posts go to. */
  account: Account | null;
  accountError: string | null;
  loading: boolean;
  connecting: boolean;
  /** Direct post is possible: enabled in settings and the active account granted video.publish. */
  canDirectPost: boolean;
  reload(): Promise<void>;
  setSettings(s: SettingsView): void;
  setAccounts(a: Account[]): void;
  selectAccount(openId: string): void;
  /** Browser login; the account that signs in is added and made active. */
  addAccount(): Promise<void>;
  cancelAdd(): void;
  disconnect(openId: string): Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeActive(openId: string | null) {
  try {
    if (openId) localStorage.setItem(ACTIVE_KEY, openId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage unavailable — selection just won't persist
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(readActive);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setSettings(await poster.getSettings());
    try {
      setAccounts(await poster.listAccounts());
      setAccountError(null);
    } catch (err) {
      setAccounts([]);
      setAccountError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectAccount = useCallback((openId: string) => {
    setActiveId(openId);
    writeActive(openId);
  }, []);

  const addAccount = useCallback(async () => {
    setConnecting(true);
    setAccountError(null);
    try {
      const added = await poster.connect();
      setAccounts(await poster.listAccounts());
      selectAccount(added.openId);
    } catch (err) {
      const message = errorMessage(err);
      setAccountError(message === "Login cancelled." ? null : message);
    } finally {
      setConnecting(false);
    }
  }, [selectAccount]);

  const disconnect = useCallback(async (openId: string) => {
    await poster.disconnect(openId);
    setAccounts(await poster.listAccounts());
  }, []);

  // Fall back to the first account when the remembered one is gone.
  const account = accounts.find((a) => a.openId === activeId) ?? accounts[0] ?? null;
  const canDirectPost = Boolean(settings?.directPostEnabled && account?.scopes.includes("video.publish"));

  return (
    <Ctx.Provider
      value={{
        settings,
        accounts,
        account,
        accountError,
        loading,
        connecting,
        canDirectPost,
        reload,
        setSettings,
        setAccounts,
        selectAccount,
        addAccount,
        cancelAdd: () => void poster.cancelConnect(),
        disconnect,
      }}
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

/** "@handle" when known, else the display name. */
export function accountLabel(a: Pick<Account, "username" | "displayName">): string {
  return a.username ? `@${a.username}` : a.displayName;
}
