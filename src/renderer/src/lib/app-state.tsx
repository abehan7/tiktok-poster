import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Account, IgAccount, SettingsView } from "@shared/contract";
import { errorMessage, poster } from "./api";

const ACTIVE_KEY = "tiktok-poster.activeAccount";
const ACTIVE_IG_KEY = "tiktok-poster.activeIgAccount";
const ACCOUNT_RECHECK_MS = 10 * 60_000;

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

  igAccounts: IgAccount[];
  /** The Instagram account new posts go to. */
  igAccount: IgAccount | null;
  igError: string | null;
  igConnecting: boolean;
  setIgAccounts(a: IgAccount[]): void;
  selectIgAccount(id: string): void;
  /** Instagram Login window; the account that signs in is added and made active. */
  addIgAccount(): Promise<void>;
  /** Adds an account from a dashboard token. Throws so the form can show why. */
  addIgToken(token: string): Promise<void>;
  disconnectIg(id: string): Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

function readActive(key = ACTIVE_KEY): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeActive(id: string | null, key = ACTIVE_KEY) {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
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
  const [igAccounts, setIgAccounts] = useState<IgAccount[]>([]);
  const [igActiveId, setIgActiveId] = useState<string | null>(() => readActive(ACTIVE_IG_KEY));
  const [igError, setIgError] = useState<string | null>(null);
  const [igConnecting, setIgConnecting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setSettings(await poster.getSettings());
    const [tiktok, instagram] = await Promise.allSettled([poster.listAccounts(), poster.listIgAccounts()]);
    setAccounts(tiktok.status === "fulfilled" ? tiktok.value : []);
    setAccountError(tiktok.status === "rejected" ? errorMessage(tiktok.reason) : null);
    setIgAccounts(instagram.status === "fulfilled" ? instagram.value : []);
    setIgError(instagram.status === "rejected" ? errorMessage(instagram.reason) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Re-list accounts so a login that stops working shows up without a restart: when the window
  // comes back, every few minutes, and right after a post fails (main flags the account then).
  useEffect(() => {
    const refresh = async () => {
      const [tiktok, instagram] = await Promise.allSettled([poster.listAccounts(), poster.listIgAccounts()]);
      if (tiktok.status === "fulfilled") setAccounts(tiktok.value);
      if (instagram.status === "fulfilled") setIgAccounts(instagram.value);
    };
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, ACCOUNT_RECHECK_MS);
    const off = poster.onHistory((e) => e.status === "FAILED" && void refresh());
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
      off();
    };
  }, []);

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

  const selectIgAccount = useCallback((id: string) => {
    setIgActiveId(id);
    writeActive(id, ACTIVE_IG_KEY);
  }, []);

  const addIgAccount = useCallback(async () => {
    setIgConnecting(true);
    setIgError(null);
    try {
      const added = await poster.connectInstagram();
      setIgAccounts(await poster.listIgAccounts());
      selectIgAccount(added.id);
    } catch (err) {
      const message = errorMessage(err);
      setIgError(message === "Login cancelled." ? null : message);
    } finally {
      setIgConnecting(false);
    }
  }, [selectIgAccount]);

  const addIgToken = useCallback(
    async (token: string) => {
      const added = await poster.addInstagramToken(token);
      setIgAccounts(await poster.listIgAccounts());
      selectIgAccount(added.id);
      setIgError(null);
    },
    [selectIgAccount],
  );

  const disconnectIg = useCallback(async (id: string) => {
    await poster.disconnectInstagram(id);
    setIgAccounts(await poster.listIgAccounts());
  }, []);

  // Fall back to the first account when the remembered one is gone.
  const account = accounts.find((a) => a.openId === activeId) ?? accounts[0] ?? null;
  const igAccount = igAccounts.find((a) => a.id === igActiveId) ?? igAccounts[0] ?? null;
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
        igAccounts,
        igAccount,
        igError,
        igConnecting,
        setIgAccounts,
        selectIgAccount,
        addIgAccount,
        addIgToken,
        disconnectIg,
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
