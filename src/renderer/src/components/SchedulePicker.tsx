import { CalendarClock } from "lucide-react";
import { Field, Input, Segmented } from "./ui";

/** "YYYY-MM-DDTHH:mm" in local time, as <input type="datetime-local"> wants. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Next quarter hour at least an hour out. */
function defaultSlot(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** null = post now; otherwise a local datetime-local string. */
export function SchedulePicker({ value, onChange }: { value: string | null; onChange(v: string | null): void }) {
  const tooSoon = value !== null && new Date(value).getTime() < Date.now() + 60_000;
  return (
    <Field
      label="When"
      hint={
        value === null
          ? undefined
          : tooSoon
            ? <span className="text-bad">Pick a time at least a minute from now.</span>
            : "TikTok Poster must be running then. Closing the window is fine; quitting isn't."
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={value === null ? "now" : "later"}
          onChange={(v) => onChange(v === "now" ? null : defaultSlot())}
          options={[
            { value: "now", label: "Post now" },
            { value: "later", label: "Schedule" },
          ]}
        />
        {value !== null && (
          <div className="relative min-w-56 flex-1">
            <CalendarClock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              type="datetime-local"
              value={value}
              min={toLocalInput(new Date(Date.now() + 60_000))}
              onChange={(e) => onChange(e.target.value)}
              className="pl-9 [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>
        )}
      </div>
    </Field>
  );
}

/** True when a schedule value is usable. */
export function scheduleOk(value: string | null): boolean {
  return value === null || new Date(value).getTime() >= Date.now() + 60_000;
}
