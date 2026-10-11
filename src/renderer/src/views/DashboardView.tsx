import { useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Users } from "lucide-react";
import type { HistoryEntry } from "@shared/contract";
import { AccountAvatar } from "@renderer/components/AccountBar";
import { PostDetail } from "@renderer/components/PostDetail";
import { Button, Card } from "@renderer/components/ui";
import { accountKey, useAccountRefs, type AccountRef } from "@renderer/lib/accounts";
import { ATTENTION, derive, type DerivedState, type PostState } from "@renderer/lib/post-state";
import { useHistory } from "@renderer/lib/use-history";
import { HistoryRow } from "./HistoryView";

type Item = { e: HistoryEntry; d: DerivedState };

const DONE: PostState[] = ["posted", "published"];
const TO_GO: PostState[] = ["upcoming", "sending"];
const DAY_MS = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const timeOf = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** One day across every account: what went out, what's still to go, what needs a decision, and who has nothing. */
export function DashboardView({ onOpenAccount }: { onOpenAccount(id: string): void }) {
  const api = useHistory();
  const refs = useAccountRefs(api.entries);
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [openId, setOpenId] = useState<string | null>(null);

  const items = useMemo(() => api.entries.map((e) => ({ e, d: derive(e, api.now) })), [api.entries, api.now]);
  const dayEnd = addDays(day, 1).getTime();
  const isToday = day.getTime() === startOfDay(new Date(api.now)).getTime();

  const rows = useMemo(() => {
    const byAccount = new Map<string, Item[]>();
    for (const i of items) byAccount.set(accountKey(i.e), [...(byAccount.get(accountKey(i.e)) ?? []), i]);
    return refs
      .map((ref) => {
        const all = byAccount.get(ref.id) ?? [];
        const today = all
          .filter((i) => i.d.state !== "cancelled" && i.d.when.getTime() >= day.getTime() && i.d.when.getTime() < dayEnd)
          .sort((a, b) => a.d.when.getTime() - b.d.when.getTime());
        const queue = all
          .filter((i) => i.d.state === "upcoming")
          .sort((a, b) => a.d.when.getTime() - b.d.when.getTime());
        const attention = all.filter((i) => ATTENTION.includes(i.d.state)).length;
        const lastSent = all
          .filter((i) => DONE.includes(i.d.state) || i.d.state === "draft")
          .reduce<Date | null>((m, i) => (!m || i.d.when > m ? i.d.when : m), null);
        return { ref, today, queue, attention, lastSent };
      })
      .filter((r) => r.ref.connected || r.today.length > 0 || r.attention > 0)
      // Busy accounts first; the stable sort keeps the usual account order within each tier.
      .sort((a, b) => tier(b) - tier(a));
  }, [items, refs, day, dayEnd]);

  const dayItems = rows.flatMap((r) => r.today);
  const count = (states: PostState[]) => dayItems.filter((i) => states.includes(i.d.state)).length;
  const idle = rows.filter((r) => r.ref.connected && r.today.length === 0).length;
  const needs = items
    .filter((i) => ATTENTION.includes(i.d.state))
    .sort((a, b) => b.d.when.getTime() - a.d.when.getTime());
  const opened = api.entries.find((e) => e.id === openId) ?? null;

  return (
    <div className="space-y-5">
      {/* Day picker */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[15px] font-semibold">
          {day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          {isToday && <span className="ml-2 font-normal text-muted">Today</span>}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
          <ChevronLeft size={16} />
        </Button>
        <Button size="sm" onClick={() => setDay(startOfDay(new Date()))} disabled={isToday}>
          Today
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* Day totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CheckCircle2} tone="text-ok" value={count(DONE)} label="Sent" hint={`of ${dayItems.length} planned`} />
        <Stat icon={Clock} tone="text-sched" value={count(TO_GO)} label="Still to go" hint={isToday ? "later today" : "scheduled"} />
        <Stat icon={AlertTriangle} tone="text-bad" value={count(ATTENTION)} label="Need attention" hint="delayed, failed, drafts" />
        <Stat icon={Users} tone="text-warn" value={idle} label="Idle accounts" hint="nothing this day" />
      </div>

      {/* Per account */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-[minmax(12rem,1.2fr)_minmax(9rem,0.8fr)_minmax(16rem,2fr)_minmax(10rem,1fr)] gap-4 border-b border-line bg-sunken/60 px-4 py-2 text-[11px] font-medium text-muted">
          <span>Account</span>
          <span>This day</span>
          <span>Timeline</span>
          <span>Queue</span>
        </div>
        {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Connect an account in Settings to see it here.</p>}
        {rows.map((r) => (
          <AccountRow key={r.ref.id} row={r} day={day} now={api.now} showNow={isToday} onOpen={() => onOpenAccount(r.ref.id)} />
        ))}
      </Card>

      {/* Needs a decision, any day */}
      {needs.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle size={15} className="text-bad" /> Needs attention · {needs.length}
          </h2>
          {api.error && <p className="selectable text-sm text-bad">{api.error}</p>}
          {needs.slice(0, 8).map(({ e }) => (
            <HistoryRow key={e.id} entry={e} api={api} onOpen={() => setOpenId(e.id)} compact />
          ))}
          {needs.length > 8 && <p className="text-xs text-muted">+{needs.length - 8} more in Calendar and History.</p>}
        </section>
      )}

      {opened && <PostDetail entry={opened} now={api.now} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function AccountRow({
  row: { ref, today, queue, attention, lastSent },
  day,
  now,
  showNow,
  onOpen,
}: {
  row: { ref: AccountRef; today: Item[]; queue: Item[]; attention: number; lastSent: Date | null };
  day: Date;
  now: number;
  showNow: boolean;
  onOpen(): void;
}) {
  const done = today.filter((i) => DONE.includes(i.d.state)).length;
  const bad = today.filter((i) => ATTENTION.includes(i.d.state)).length;
  const toGo = today.filter((i) => TO_GO.includes(i.d.state)).length;
  const next = queue.find((i) => i.d.when.getTime() > now);
  const last = queue.at(-1);
  const pct = (n: number) => (today.length ? `${(n / today.length) * 100}%` : "0%");

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open this account in Calendar"
      className="grid w-full grid-cols-[minmax(12rem,1.2fr)_minmax(9rem,0.8fr)_minmax(16rem,2fr)_minmax(10rem,1fr)] items-center gap-4 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-sunken/50"
    >
      {/* Account */}
      <span className="flex min-w-0 items-center gap-3">
        <AccountAvatar account={ref} size={32} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{ref.handle}</span>
          <span className="block truncate text-xs text-muted">
            {!ref.connected ? "not connected" : lastSent ? `last sent ${relDay(lastSent, now)}` : "nothing sent yet"}
          </span>
        </span>
      </span>

      {/* This day */}
      <span className="space-y-1.5">
        {today.length === 0 ? (
          <span className="text-xs font-medium text-warn">Nothing planned</span>
        ) : (
          <>
            <span className="flex items-baseline gap-1.5 text-xs">
              <span className="text-sm font-semibold tabular-nums">
                {done}/{today.length}
              </span>
              <span className="text-muted">sent</span>
              {bad > 0 && <span className="font-medium text-bad">· {bad} issue{bad === 1 ? "" : "s"}</span>}
            </span>
            <span className="flex h-1.5 overflow-hidden rounded-full bg-sunken">
              <span className="bg-ok" style={{ width: pct(done) }} />
              <span className="bg-bad" style={{ width: pct(bad) }} />
              <span className="bg-sched/70" style={{ width: pct(toGo) }} />
            </span>
          </>
        )}
      </span>

      {/* Timeline */}
      <DayTrack items={today} day={day} now={now} showNow={showNow} />

      {/* Queue */}
      <span className="min-w-0 text-xs">
        {next ? (
          <>
            <span className="block truncate">
              Next <span className="font-medium">{relDay(next.d.when, now, true)}</span>
            </span>
            <span className="block truncate text-muted">
              {queue.length} scheduled{last && ` · through ${last.d.when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            </span>
          </>
        ) : ref.connected ? (
          <span className="font-medium text-warn">Queue empty</span>
        ) : (
          <span className="text-muted">—</span>
        )}
        {attention > bad && <span className="block text-bad">{attention} need attention overall</span>}
      </span>
    </button>
  );
}

/** A 24-hour strip with a dot per post at its time, colored by status. */
function DayTrack({ items, day, now, showNow }: { items: Item[]; day: Date; now: number; showNow: boolean }) {
  const at = (t: number) => `${Math.min(100, Math.max(0, ((t - day.getTime()) / DAY_MS) * 100))}%`;
  return (
    <span className="relative block h-7">
      <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
      {[0, 6, 12, 18, 24].map((h) => (
        <span key={h} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line" style={{ left: `${(h / 24) * 100}%` }} />
      ))}
      {[6, 12, 18].map((h) => (
        <span key={h} className="absolute bottom-[-6px] -translate-x-1/2 text-[9px] text-muted/70" style={{ left: `${(h / 24) * 100}%` }}>
          {h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`}
        </span>
      ))}
      {showNow && <span className="absolute inset-y-0 w-px bg-accent" style={{ left: at(now) }} />}
      {items.map(({ e, d }) => (
        <span
          key={e.id}
          title={`${timeOf(d.when)} · ${d.label} · ${e.label}`}
          className={clsx("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel", d.dot)}
          style={{ left: at(d.when.getTime()) }}
        />
      ))}
    </span>
  );
}

function Stat({
  icon: Icon,
  tone,
  value,
  label,
  hint,
}: {
  icon: typeof Clock;
  tone: string;
  value: number;
  label: string;
  hint: string;
}) {
  const lit = value > 0;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3">
      <Icon size={20} className={lit ? tone : "text-muted/50"} />
      <span className={clsx("text-2xl font-semibold tabular-nums", lit ? "text-text" : "text-muted")}>
        {value}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </div>
  );
}

function tier(r: { today: Item[]; queue: Item[]; attention: number }): number {
  return (r.attention > 0 ? 4 : 0) + (r.today.length > 0 ? 2 : 0) + (r.queue.length > 0 ? 1 : 0);
}

/** "3:01 PM" today, "yesterday", "tomorrow 12:05 AM", or a short date. */
function relDay(d: Date, now: number, withTime = false): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date(now)).getTime()) / DAY_MS);
  const t = withTime ? ` ${timeOf(d)}` : "";
  if (diff === 0) return withTime ? timeOf(d) : "today";
  if (diff === -1) return `yesterday${t}`;
  if (diff === 1) return `tomorrow${t}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}${t}`;
}
