import { useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Inbox, Trash2, XCircle } from "lucide-react";
import type { HistoryEntry } from "@shared/contract";
import { AccountAvatar, AccountBar } from "@renderer/components/AccountBar";
import { PlatformIcon, platformOf } from "@renderer/components/Platform";
import { PostDetail } from "@renderer/components/PostDetail";
import { Button, Card } from "@renderer/components/ui";
import { accountKey, groupByAccount, useAccountRefs, type AccountRef } from "@renderer/lib/accounts";
import { derive, type DerivedState, type PostState } from "@renderer/lib/post-state";
import { useHistory } from "@renderer/lib/use-history";
import { HistoryRow } from "./HistoryView";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

/** Month grid of posts by their scheduled (or sent) time, colored by status. */
export function CalendarView({ account, onAccount }: { account: string; onAccount(id: string): void }) {
  const api = useHistory();
  const refs = useAccountRefs(api.entries);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date>(() => new Date());
  const [stateFilter, setStateFilter] = useState<PostState | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // A remembered account that's gone falls back to everything.
  const accountFilter = account !== "all" && refs.some((r) => r.id === account) ? account : "all";
  const allAccounts = accountFilter === "all";

  const visible = useMemo(
    () =>
      api.entries
        .filter((e) => allAccounts || accountKey(e) === accountFilter)
        .map((e) => ({ e, d: derive(e, api.now) }))
        .filter(({ d }) => !stateFilter || d.state === stateFilter || (stateFilter === "failed" && d.state === "missed")),
    [api.entries, api.now, allAccounts, accountFilter, stateFilter],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, typeof visible>();
    for (const item of visible) {
      const k = dayKey(item.d.when);
      m.set(k, [...(m.get(k) ?? []), item]);
    }
    for (const list of m.values()) list.sort((a, b) => a.d.when.getTime() - b.d.when.getTime());
    return m;
  }, [visible]);

  // Attention counts ignore the state filter (they're the way into it).
  const counts = useMemo(() => {
    const c: Partial<Record<PostState, number>> = {};
    for (const e of api.entries) {
      if (!allAccounts && accountKey(e) !== accountFilter) continue;
      const s = derive(e, api.now).state;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [api.entries, api.now, allAccounts, accountFilter]);

  // Chip counts: posts per account in the month on screen.
  const monthCounts = useMemo(() => {
    const c: Record<string, number> = {};
    let total = 0;
    for (const e of api.entries) {
      const when = derive(e, api.now).when;
      if (when.getFullYear() !== month.getFullYear() || when.getMonth() !== month.getMonth()) continue;
      c[accountKey(e)] = (c[accountKey(e)] ?? 0) + 1;
      total++;
    }
    return { c, total };
  }, [api.entries, api.now, month]);

  // Cancelled posts for the account(s) on screen, any month.
  const cancelledIds = useMemo(
    () =>
      api.entries
        .filter((e) => e.status === "CANCELLED" && (allAccounts || accountKey(e) === accountFilter))
        .map((e) => e.id),
    [api.entries, allAccounts, accountFilter],
  );
  const clearCancelled = () => {
    const n = cancelledIds.length;
    if (!window.confirm(`Delete ${n} cancelled post${n === 1 ? "" : "s"} from history? This can't be undone.`)) return;
    void api.clearCancelled(cancelledIds);
  };

  const days = monthGrid(month);
  const today = new Date();
  const dayItems = byDay.get(dayKey(selected)) ?? [];
  const opened = api.entries.find((e) => e.id === openId) ?? null;

  return (
    <div className="space-y-5">
      <AccountBar refs={refs} value={accountFilter} onChange={onAccount} counts={monthCounts.c} total={monthCounts.total} />

      {/* Needs attention */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AttentionCard
          icon={AlertTriangle}
          tone="text-warn"
          label="Delayed"
          hint="past due, not sent"
          count={counts.delayed ?? 0}
          active={stateFilter === "delayed"}
          onClick={() => setStateFilter(stateFilter === "delayed" ? null : "delayed")}
        />
        <AttentionCard
          icon={Inbox}
          tone="text-cyan"
          label="Drafts to post"
          hint="add sound & publish"
          count={counts.draft ?? 0}
          active={stateFilter === "draft"}
          onClick={() => setStateFilter(stateFilter === "draft" ? null : "draft")}
        />
        <AttentionCard
          icon={XCircle}
          tone="text-bad"
          label="Failed / missed"
          hint="needs a decision"
          count={(counts.failed ?? 0) + (counts.missed ?? 0)}
          active={stateFilter === "failed"}
          onClick={() => setStateFilter(stateFilter === "failed" ? null : "failed")}
        />
        <AttentionCard
          icon={Clock}
          tone="text-sched"
          label="Upcoming"
          hint="scheduled"
          count={counts.upcoming ?? 0}
          active={stateFilter === "upcoming"}
          onClick={() => setStateFilter(stateFilter === "upcoming" ? null : "upcoming")}
        />
      </div>

      <Card className="p-4">
        {/* Toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-[15px] font-semibold">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </h2>
          <Button size="sm" variant="ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
            <ChevronLeft size={16} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setMonth(startOfMonth(new Date()));
              setSelected(new Date());
            }}
          >
            Today
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
            <ChevronRight size={16} />
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {cancelledIds.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearCancelled} title="Delete every cancelled post from history">
                <Trash2 size={13} /> Clear cancelled ({cancelledIds.length})
              </Button>
            )}
            {stateFilter && (
              <Button size="sm" variant="ghost" onClick={() => setStateFilter(null)}>
                Clear filter
              </Button>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-line">
          {WEEKDAYS.map((w) => (
            <div key={w} className="border-b border-line bg-sunken/60 px-2 py-1.5 text-[11px] font-medium text-muted">
              {w}
            </div>
          ))}
          {days.map((day, i) => {
            const items = byDay.get(dayKey(day)) ?? [];
            const inMonth = day.getMonth() === month.getMonth();
            const isSel = sameDay(day, selected);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(day)}
                className={clsx(
                  "flex min-h-24 flex-col gap-1 border-line p-1.5 text-left align-top transition-colors",
                  i % 7 !== 6 && "border-r",
                  i < days.length - 7 && "border-b",
                  inMonth ? "bg-panel hover:bg-sunken/50" : "bg-bg/40 text-muted/60",
                  isSel && "bg-sunken ring-2 ring-inset ring-accent/60",
                )}
              >
                <span
                  className={clsx(
                    "grid size-6 place-items-center rounded-full text-xs",
                    sameDay(day, today) ? "bg-accent font-semibold text-accent-ink" : "text-muted",
                  )}
                >
                  {day.getDate()}
                </span>
                {allAccounts ? <AccountCellRows refs={refs} items={items} /> : <PostCellRows items={items} />}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {(
            [
              ["bg-sched", "Scheduled"],
              ["bg-warn", "Delayed"],
              ["bg-warn/70", "Sending"],
              ["bg-cyan", "Draft ready"],
              ["bg-ok", "Published / posted"],
              ["bg-bad", "Failed / missed"],
            ] as const
          ).map(([dot, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={clsx("size-2 rounded-full", dot)} /> {label}
            </span>
          ))}
        </div>
      </Card>

      {/* Selected day */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          {selected.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          <span className="ml-2 font-normal text-muted">
            {dayItems.length ? `${dayItems.length} post${dayItems.length === 1 ? "" : "s"}` : "Nothing this day"}
          </span>
        </h2>
        {api.error && <p className="selectable text-sm text-bad">{api.error}</p>}
        {allAccounts
          ? groupByAccount(refs, dayItems, (i) => i.e).map(({ ref, items }) => (
              <div key={ref.id} className="space-y-2">
                <button
                  type="button"
                  onClick={() => onAccount(ref.id)}
                  className="flex items-center gap-2 pt-1 text-[13px] font-medium hover:text-text"
                  title="Show only this account"
                >
                  <AccountAvatar account={ref} size={22} />
                  {ref.handle}
                  <span className="font-normal text-muted">· {items.length}</span>
                </button>
                <div className="ml-2.5 space-y-2 border-l border-line pl-4">
                  {items.map(({ e }) => (
                    <HistoryRow key={e.id} entry={e} api={api} onOpen={() => setOpenId(e.id)} compact />
                  ))}
                </div>
              </div>
            ))
          : dayItems.map(({ e }) => <HistoryRow key={e.id} entry={e} api={api} onOpen={() => setOpenId(e.id)} compact />)}
      </section>

      {opened && <PostDetail entry={opened} now={api.now} onClose={() => setOpenId(null)} />}
    </div>
  );
}

type CellItem = { e: HistoryEntry; d: DerivedState };

/** Most urgent first: a cell shows the worst state of an account's posts that day. */
const SEVERITY: PostState[] = ["failed", "missed", "delayed", "draft", "sending", "upcoming", "published", "posted", "cancelled"];

/** All-accounts cell: one line per account with how many posts it has that day. */
function AccountCellRows({ refs, items }: { refs: AccountRef[]; items: CellItem[] }) {
  const groups = groupByAccount(refs, items, (i) => i.e);
  return (
    <>
      {groups.slice(0, 4).map(({ ref, items: own }) => {
        const worst = own.reduce((w, i) => (SEVERITY.indexOf(i.d.state) < SEVERITY.indexOf(w.d.state) ? i : w));
        const live = own.filter((i) => i.d.state !== "cancelled").length;
        return (
          <span
            key={ref.id}
            title={`${ref.handle}: ${own.length} post${own.length === 1 ? "" : "s"}`}
            className={clsx("flex items-center gap-1 rounded bg-sunken px-1 py-0.5 text-[10.5px] leading-tight", live === 0 && "text-muted line-through")}
          >
            <span className={clsx("size-1.5 shrink-0 rounded-full", worst.d.dot)} />
            <AccountAvatar account={ref} size={13} />
            <span className="min-w-0 flex-1 truncate">{ref.handle}</span>
            <span className="tabular-nums text-muted">{own.length}</span>
          </span>
        );
      })}
      {groups.length > 4 && <span className="px-1 text-[10.5px] text-muted">+{groups.length - 4} accounts</span>}
    </>
  );
}

/** Single-account cell: each post with its time. */
function PostCellRows({ items }: { items: CellItem[] }) {
  return (
    <>
      {items.slice(0, 3).map(({ e, d }) => (
        <span
          key={e.id}
          title={`${d.label} · ${e.label}`}
          className={clsx(
            "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10.5px] leading-tight",
            d.state === "cancelled" ? "text-muted line-through" : "bg-sunken",
          )}
        >
          <span className={clsx("size-1.5 shrink-0 rounded-full", d.dot)} />
          <PlatformIcon platform={platformOf(e)} size={10} className="shrink-0" />
          <span className="tabular-nums text-muted">
            {d.when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className="truncate">{e.label}</span>
        </span>
      ))}
      {items.length > 3 && <span className="px-1 text-[10.5px] text-muted">+{items.length - 3} more</span>}
    </>
  );
}

function AttentionCard({
  icon: Icon,
  tone,
  label,
  hint,
  count,
  active,
  onClick,
}: {
  icon: typeof Clock;
  tone: string;
  label: string;
  hint: string;
  count: number;
  active: boolean;
  onClick(): void;
}) {
  const needs = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 rounded-xl border bg-panel px-4 py-3 text-left transition-colors hover:bg-sunken",
        active ? "border-accent" : "border-line",
      )}
    >
      <Icon size={20} className={clsx(needs ? tone : "text-muted/50")} />
      <span className={clsx("text-2xl font-semibold tabular-nums", needs ? "text-text" : "text-muted")}>{count}</span>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** 6 weeks starting on the Sunday on/before the 1st. */
function monthGrid(month: Date): Date[] {
  const start = new Date(month);
  start.setDate(1 - start.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

