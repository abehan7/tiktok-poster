const UNIT_MS: Record<string, number> = { m: 60_000, h: 3600_000, d: 86_400_000 };

export const WHEN_HELP = `"+30m", "in 2h", "+1d2h", "21:30", "9pm", "tomorrow 9:00", "2026-10-12 09:00" (local) or ISO 8601 with an offset`;

/** Parses a schedule time. Bare clock times mean the next time it's that time (today, else tomorrow). */
export function parseWhen(input: string, now = new Date()): Date {
  const s = input.trim().toLowerCase();

  const rel = /^(?:in\s+|\+)((?:\d+\s*[mhd]\s*)+)$/.exec(s);
  if (rel) {
    let ms = 0;
    for (const [, n, unit] of rel[1].matchAll(/(\d+)\s*([mhd])/g)) ms += Number(n) * UNIT_MS[unit];
    return new Date(now.getTime() + ms);
  }

  const clock = /^(today|tomorrow)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (clock && (clock[3] !== undefined || clock[4])) {
    const [, day, hh, mm = "0", ampm] = clock;
    let hour = Number(hh);
    if (ampm) {
      if (hour < 1 || hour > 12) throw new Error(`Not a time: ${input}`);
      hour = (hour % 12) + (ampm === "pm" ? 12 : 0);
    }
    if (hour > 23 || Number(mm) > 59) throw new Error(`Not a time: ${input}`);
    const d = new Date(now);
    d.setHours(hour, Number(mm), 0, 0);
    if (day === "tomorrow" || (!day && d <= now)) d.setDate(d.getDate() + 1);
    return d;
  }

  const local = /^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (local) {
    const [, y, mo, d, h, mi, sec = "0"] = local;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  }

  const t = Date.parse(input);
  if (Number.isNaN(t)) throw new Error(`Couldn't read the time "${input}". Try ${WHEN_HELP}.`);
  return new Date(t);
}
