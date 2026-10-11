import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Plus, Settings2 } from "lucide-react";
import { useAppState } from "@renderer/lib/app-state";
import { Avatar } from "./Avatar";
import { Button } from "./ui";

/** Header control: active account + switcher, "Add account…", link to account management. */
export function AccountMenu({ onManage }: { onManage(): void }) {
  const { accounts, account, accountError, loading, connecting, selectAccount, addAccount, cancelAdd } = useAppState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (loading) return null;

  if (connecting) {
    return (
      <div className="no-drag flex items-center gap-3">
        <span className="text-xs text-muted">Waiting for browser…</span>
        <Button size="sm" onClick={cancelAdd}>
          Cancel
        </Button>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="no-drag flex items-center gap-3">
        {accountError && (
          <span className="selectable max-w-80 truncate text-xs text-bad" title={accountError}>
            {accountError}
          </span>
        )}
        <Button variant="primary" size="sm" onClick={() => void addAccount()}>
          Connect TikTok
        </Button>
      </div>
    );
  }

  return (
    <div ref={ref} className="no-drag relative flex items-center gap-3">
      {accountError && (
        <span className="selectable max-w-72 truncate text-xs text-bad" title={accountError}>
          {accountError}
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-sunken"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar account={account} />
        <span className="text-left leading-tight">
          <span className="block text-sm font-medium">{account.displayName}</span>
          {account.username && <span className="block text-[11px] text-muted">@{account.username}</span>}
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-line bg-panel shadow-xl"
        >
          <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wide text-muted">
            Post as · {accounts.length} account{accounts.length === 1 ? "" : "s"}
          </p>
          <ul className="max-h-80 overflow-y-auto">
            {accounts.map((a) => (
              <li key={a.openId}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={a.openId === account.openId}
                  onClick={() => {
                    selectAccount(a.openId);
                    setOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-sunken",
                    a.openId === account.openId && "bg-sunken/60",
                  )}
                >
                  <Avatar account={a} size={32} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-medium">{a.displayName}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {a.username ? `@${a.username}` : "TikTok account"}
                    </span>
                    {a.loginProblem ? (
                      <span className="block truncate text-[11px] text-bad" title={a.loginProblem}>
                        Login dead: reconnect in Settings
                      </span>
                    ) : a.note ? (
                      <span className="selectable block truncate text-[11px] text-text/80">{a.note}</span>
                    ) : (
                      <span className="block truncate text-[11px] text-warn">Login email / ID not set</span>
                    )}
                  </span>
                  {a.openId === account.openId && <Check size={15} className="shrink-0 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-1">
            <MenuAction
              icon={Plus}
              label="Add account…"
              hint="Sign in to the other account in your browser first"
              onClick={() => {
                setOpen(false);
                void addAccount();
              }}
            />
            <MenuAction
              icon={Settings2}
              label="Manage accounts…"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuAction({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  hint?: string;
  onClick(): void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-sunken">
      <Icon size={15} className="mt-0.5 shrink-0 text-muted" />
      <span className="leading-tight">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
    </button>
  );
}

