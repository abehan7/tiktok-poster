import type { ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, Users } from "lucide-react";
import type { AccountRef } from "@renderer/lib/accounts";
import { Avatar } from "./Avatar";
import { PlatformIcon } from "./Platform";

/** Avatar with a small platform badge in the corner. */
export function AccountAvatar({ account, size = 24 }: { account: AccountRef; size?: number }) {
  const badge = Math.max(10, Math.round(size * 0.5));
  return (
    <span className={clsx("relative shrink-0", !account.connected && "opacity-60")} style={{ width: size, height: size }}>
      <Avatar account={account} size={size} />
      <span
        className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-panel"
        style={{ width: badge, height: badge }}
      >
        <PlatformIcon platform={account.platform} size={Math.round(badge * 0.75)} />
      </span>
    </span>
  );
}

/** "All accounts" + one chip per account. `counts` shows a number next to each (accounts without one are hidden unless connected). */
export function AccountBar({
  refs,
  value,
  onChange,
  counts,
  total,
}: {
  refs: AccountRef[];
  value: string;
  onChange(id: string): void;
  counts: Record<string, number>;
  total: number;
}) {
  const shown = refs.filter((r) => r.connected || counts[r.id]);
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Account">
      <Chip active={value === "all"} onClick={() => onChange("all")} count={total}>
        <Users size={15} className="text-muted" /> All accounts
      </Chip>
      {shown.map((r) => (
        <Chip
          key={r.id}
          active={value === r.id}
          onClick={() => onChange(r.id)}
          count={counts[r.id] ?? 0}
          title={r.loginProblem ? `${r.handle}: login dead. ${r.loginProblem}` : r.connected ? r.handle : `${r.handle} (not connected)`}
        >
          <AccountAvatar account={r} size={20} />
          <span className="max-w-40 truncate">{r.handle}</span>
          {r.loginProblem && <AlertTriangle size={14} className="shrink-0 text-bad" aria-label="Login dead" />}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  count,
  title,
  children,
}: {
  active: boolean;
  onClick(): void;
  count: number;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={title}
      onClick={onClick}
      className={clsx(
        "flex h-9 items-center gap-2 rounded-full border pl-2 pr-2.5 text-sm transition-colors",
        active ? "border-accent bg-sunken font-medium" : "border-line bg-panel text-muted hover:bg-sunken hover:text-text",
      )}
    >
      {children}
      <span className={clsx("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-accent text-accent-ink" : "bg-sunken")}>{count}</span>
    </button>
  );
}
