import clsx from "clsx";
import { UserRound } from "lucide-react";
import type { Account } from "@shared/contract";

export function Avatar({ account, size = 28 }: { account: Pick<Account, "avatarUrl"> | null; size?: number }) {
  const style = { width: size, height: size };
  return account?.avatarUrl ? (
    <img src={account.avatarUrl} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={style} className={clsx("grid shrink-0 place-items-center rounded-full bg-sunken text-muted")}>
      <UserRound size={Math.round(size * 0.55)} />
    </span>
  );
}
