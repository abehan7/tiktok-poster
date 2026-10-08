import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-cyan",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-[15px]",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
        variant === "secondary" && "border border-line bg-panel hover:bg-sunken",
        variant === "ghost" && "text-muted hover:bg-sunken hover:text-text",
        variant === "danger" && "text-bad hover:bg-sunken",
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx("rounded-xl border border-line bg-panel p-5", className)}>{children}</section>;
}

export function Field({
  label,
  hint,
  counter,
  children,
}: {
  label: string;
  hint?: ReactNode;
  counter?: { value: number; max: number };
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-[13px] font-medium">
        {label}
        {counter && (
          <span className={clsx("text-xs tabular-nums", counter.value > counter.max ? "text-bad" : "text-muted")}>
            {counter.value}/{counter.max}
          </span>
        )}
      </span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-sunken px-3 text-sm outline-none placeholder:text-muted/70 focus:border-cyan";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputClass, "h-9", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputClass, "resize-y py-2 leading-relaxed", props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={clsx("flex items-start gap-3", disabled ? "opacity-50" : "cursor-pointer")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-line",
        )}
      >
        <span
          className={clsx(
            "absolute left-0 top-0.5 size-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </button>
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange(v: T): void;
  options: { value: T; label: string; disabled?: boolean }[];
}) {
  return (
    <div className="inline-flex rounded-lg bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            "h-8 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === o.value ? "bg-panel shadow-sm" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2 text-[13px] leading-relaxed",
        tone === "info" && "border-line bg-sunken text-muted",
        tone === "warn" && "border-warn/40 bg-warn/10 text-warn",
        tone === "bad" && "border-bad/40 bg-bad/10 text-bad selectable",
        tone === "ok" && "border-ok/40 bg-ok/10 text-ok",
      )}
    >
      {children}
    </div>
  );
}

export function ProgressBar({ stage, fraction }: { stage: string; fraction: number | null }) {
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
        <div
          className={clsx("h-full rounded-full bg-accent transition-[width]", fraction === null && "w-1/3 animate-pulse")}
          style={fraction === null ? undefined : { width: `${Math.max(4, fraction * 100)}%` }}
        />
      </div>
      <p className="text-xs text-muted">{stage}</p>
    </div>
  );
}
