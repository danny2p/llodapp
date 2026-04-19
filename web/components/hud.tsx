"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

// ──────────────────────────────────────────────────────────────────
// PANEL
// ──────────────────────────────────────────────────────────────────

export function Panel({
  title,
  id,
  subtitle,
  children,
  right,
  className = "",
  tone = "default",
}: {
  title?: string;
  id?: string;
  subtitle?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  tone?: "default" | "accent" | "warn";
}) {
  const toneBar =
    tone === "accent"
      ? "bg-[var(--hud-teal)]"
      : tone === "warn"
      ? "bg-[var(--hud-amber)]"
      : "bg-[var(--hud-line-strong)]";
  return (
    <section className={`hud-panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--hud-line)]">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-[3px] h-4 ${toneBar}`} aria-hidden />
            <div className="flex flex-col min-w-0">
              <div className="flex items-baseline gap-2">
                {id && (
                  <span className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider">
                    {id}
                  </span>
                )}
                <h3 className="font-display text-[11px] uppercase tracking-[0.12em] text-[var(--hud-teal-bright)] truncate">
                  {title}
                </h3>
              </div>
              {subtitle && (
                <span className="text-[10px] font-mono text-[var(--hud-text-faint)] truncate">
                  {subtitle}
                </span>
              )}
            </div>
          </div>
          {right}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// COLLAPSIBLE GROUP
// ──────────────────────────────────────────────────────────────────

export function Group({
  title,
  code,
  children,
  collapsible = true,
  defaultOpen = false,
  tone = "default",
  }: {
  title: string;
  code?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  tone?: "default" | "accent" | "warn";
  }) {

  const [open, setOpen] = useState(defaultOpen);
  const barColor =
    tone === "accent"
      ? "bg-[var(--hud-teal)]"
      : tone === "warn"
      ? "bg-[var(--hud-amber)]"
      : "bg-[var(--hud-line-strong)]";

  return (
    <div className="border-t border-[var(--hud-line)] first:border-t-0">
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        disabled={!collapsible}
        className="flex items-center justify-between w-full py-2.5 px-0 text-left group/g cursor-pointer disabled:cursor-default"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-[2px] h-3 ${barColor}`} aria-hidden />
          {code && (
            <span className="text-[9px] font-mono text-[var(--hud-text-faint)]">
              {code}
            </span>
          )}
          <span className="font-display text-[10.5px] uppercase tracking-[0.14em] text-[var(--hud-text-dim)] group-hover/g:text-[var(--hud-teal-bright)] transition-colors">
            {title}
          </span>
        </div>
        {collapsible && (
          <ChevronDown
            size={12}
            className={`text-[var(--hud-text-faint)] group-hover/g:text-[var(--hud-teal-bright)] transition-transform ${
              open ? "rotate-0" : "-rotate-90"
            }`}
          />
        )}
      </button>
      {open && (
        <div className="pb-3 flex flex-col gap-2.5 animate-hud-fade-up">
          {children}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// SLIDER
// ──────────────────────────────────────────────────────────────────

export function Slider({
  label,
  code,
  unit,
  value,
  min,
  max,
  step,
  hint,
  onChange,
  disabled,
}: {
  label: string;
  code?: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const valueText =
    Number.isInteger(value) ? value.toString() : value.toFixed(2);

  return (
    <div
      className={`flex flex-col gap-1 ${
        disabled ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          {code && (
            <span className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider">
              {code}
            </span>
          )}
          <span className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--hud-text-dim)] truncate">
            {label}
          </span>
        </div>
        <div className="flex items-baseline gap-1 font-mono shrink-0">
          <span className="text-[11px] text-[var(--hud-teal-bright)] tabular-nums">
            {valueText}
          </span>
          {unit && (
            <span className="text-[9px] text-[var(--hud-text-faint)] uppercase">
              {unit}
            </span>
          )}
        </div>
      </div>

      <div className="relative">
        <input
          type="range"
          className="hud-range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={{ ["--hud-fill" as string]: `${pct}%` }}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>

      <div className="flex items-center justify-between text-[9px] font-mono text-[var(--hud-text-ghost)] -mt-0.5">
        <span>{min}</span>
        <div className="flex-1 mx-2 hud-ticks" />
        <span>{max}</span>
      </div>

      {hint && (
        <span className="text-[10px] font-mono text-[var(--hud-text-faint)] leading-tight mt-0.5">
          {hint}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// SELECT
// ──────────────────────────────────────────────────────────────────

export function Select({
  label,
  code,
  value,
  options,
  onChange,
  disabled,
  format,
}: {
  label: string;
  code?: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        disabled ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      <div className="flex items-baseline gap-1.5">
        {code && (
          <span className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider">
            {code}
          </span>
        )}
        <span className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--hud-text-dim)]">
          {label}
        </span>
      </div>
      <select
        className="hud-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {format ? format(o) : o.toLocaleString()}
          </option>
        ))}
      </select>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// COLOR PICKER
// ──────────────────────────────────────────────────────────────────

export function ColorPicker({
  label,
  code,
  value,
  onChange,
  disabled,
}: {
  label: string;
  code?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        disabled ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      <div className="flex items-baseline gap-1.5 min-w-0">
        {code && (
          <span className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider">
            {code}
          </span>
        )}
        <span className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--hud-text-dim)] truncate">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2 font-mono">
        <span className="text-[10px] text-[var(--hud-text-dim)] tabular-nums uppercase">
          {value}
        </span>
        <div className="relative w-8 h-4 border border-[var(--hud-line-strong)] cursor-pointer overflow-hidden">
          <input
            type="color"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="absolute -inset-1 w-[200%] h-[200%] cursor-pointer opacity-0"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: value }}
          />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// TOGGLE
// ──────────────────────────────────────────────────────────────────

export function Toggle({
  label,
  code,
  checked,
  hint,
  onChange,
  disabled,
}: {
  label: string;
  code?: string;
  checked: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex flex-col gap-0.5 cursor-pointer ${
        disabled ? "opacity-40 pointer-events-none" : ""
      }`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-baseline gap-1.5 min-w-0">
          {code && (
            <span className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider">
              {code}
            </span>
          )}
          <span className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--hud-text-dim)] truncate">
            {label}
          </span>
        </span>
        <span
          className={`relative inline-flex items-center justify-center w-9 h-4 border ${
            checked
              ? "border-[var(--hud-teal-bright)]"
              : "border-[var(--hud-line-strong)]"
          } transition-colors`}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
          <span
            className={`block w-3 h-2.5 transition-all ${
              checked
                ? "translate-x-[9px] bg-[var(--hud-teal-bright)] shadow-[0_0_6px_rgba(94,234,212,0.7)]"
                : "translate-x-[-9px] bg-[var(--hud-text-faint)]"
            }`}
          />
        </span>
      </span>
      {hint && (
        <span className="text-[10px] font-mono text-[var(--hud-text-faint)] leading-tight">
          {hint}
        </span>
      )}
    </label>
  );
}

// ──────────────────────────────────────────────────────────────────
// BUTTON
// ──────────────────────────────────────────────────────────────────

export function Button({
  children,
  onClick,
  disabled,
  variant = "default",
  icon,
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
  icon?: React.ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  const cls =
    variant === "primary"
      ? "hud-btn hud-btn-primary"
      : variant === "danger"
      ? "hud-btn hud-btn-danger"
      : "hud-btn";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${cls} ${className} inline-flex items-center justify-center gap-2`}
    >
      {icon}
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────
// STATUS LED + PILL
// ──────────────────────────────────────────────────────────────────

export function LED({
  state,
  label,
  size = 6,
}: {
  state: "on" | "warn" | "err" | "off";
  label?: string;
  size?: number;
}) {
  const cls =
    state === "on"
      ? "hud-led-on"
      : state === "warn"
      ? "hud-led-warn"
      : state === "err"
      ? "hud-led-err"
      : "hud-led-off";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`hud-led ${cls}`}
        style={{ width: size, height: size }}
      />
      {label && (
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--hud-text-dim)]">
          {label}
        </span>
      )}
    </span>
  );
}

export function Pill({
  children,
  tone = "default",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "warn" | "danger" | "dim";
  className?: string;
}) {
  const toneCls =
    tone === "accent"
      ? "border-[var(--hud-teal-bright)] text-[var(--hud-teal-bright)] bg-[rgba(45,212,191,0.08)]"
      : tone === "warn"
      ? "border-[rgba(251,191,36,0.55)] text-[var(--hud-amber-bright)] bg-[rgba(251,191,36,0.06)]"
      : tone === "danger"
      ? "border-[rgba(239,68,68,0.55)] text-[var(--hud-red)] bg-[rgba(239,68,68,0.05)]"
      : tone === "dim"
      ? "border-[var(--hud-text-ghost)] text-[var(--hud-text-faint)]"
      : "border-[var(--hud-line-strong)] text-[var(--hud-text-dim)]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 border text-[10px] font-mono uppercase tracking-wider ${toneCls} ${className}`}
    >
      {children}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// BOOT SEQUENCE / TERMINAL LINE
// ──────────────────────────────────────────────────────────────────

export function TerminalLine({
  children,
  tone = "default",
  stamp,
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "warn" | "danger" | "success";
  stamp?: string;
}) {
  const toneCls =
    tone === "accent"
      ? "text-[var(--hud-teal-bright)]"
      : tone === "warn"
      ? "text-[var(--hud-amber-bright)]"
      : tone === "danger"
      ? "text-[var(--hud-red)]"
      : tone === "success"
      ? "text-[var(--hud-green)]"
      : "text-[var(--hud-text-dim)]";
  return (
    <div className="flex items-baseline gap-2 font-mono text-[11px] leading-tight">
      {stamp && (
        <span className="text-[var(--hud-text-ghost)] tabular-nums">
          {stamp}
        </span>
      )}
      <span className={`${toneCls}`}>&gt; {children}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// LIVE CLOCK
// ──────────────────────────────────────────────────────────────────

export function LiveClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hh = d.getHours().toString().padStart(2, "0");
      const mm = d.getMinutes().toString().padStart(2, "0");
      const ss = d.getSeconds().toString().padStart(2, "0");
      setNow(`${hh}:${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-[11px] tabular-nums text-[var(--hud-teal-bright)]">
      {now || "--:--:--"}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// ROTATING SCAN RETICLE (SVG, for loading states)
// ──────────────────────────────────────────────────────────────────

export function ScanReticle({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
      <g className="animate-hud-spin-slow" style={{ transformOrigin: "12px 12px" }}>
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="var(--hud-teal-bright)"
          strokeWidth="0.6"
          strokeDasharray="3 2"
          opacity="0.7"
        />
      </g>
      <circle
        cx="12"
        cy="12"
        r="4"
        fill="none"
        stroke="var(--hud-teal-bright)"
        strokeWidth="0.8"
      />
      <line
        x1="12"
        y1="0"
        x2="12"
        y2="4"
        stroke="var(--hud-teal-bright)"
        strokeWidth="0.8"
      />
      <line
        x1="12"
        y1="20"
        x2="12"
        y2="24"
        stroke="var(--hud-teal-bright)"
        strokeWidth="0.8"
      />
      <line
        x1="0"
        y1="12"
        x2="4"
        y2="12"
        stroke="var(--hud-teal-bright)"
        strokeWidth="0.8"
      />
      <line
        x1="20"
        y1="12"
        x2="24"
        y2="12"
        stroke="var(--hud-teal-bright)"
        strokeWidth="0.8"
      />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// TYPING-ON BOOT STREAM
// ──────────────────────────────────────────────────────────────────

export function TypingLines({
  lines,
  speed = 30,
}: {
  lines: string[];
  speed?: number;
}) {
  const [shown, setShown] = useState<string[]>([]);
  const idxRef = useRef(0);
  useEffect(() => {
    setShown([]);
    idxRef.current = 0;
    const id = setInterval(() => {
      if (idxRef.current >= lines.length) {
        clearInterval(id);
        return;
      }
      setShown((prev) => [...prev, lines[idxRef.current]]);
      idxRef.current++;
    }, speed);
    return () => clearInterval(id);
  }, [lines, speed]);
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((l, i) => (
        <TerminalLine key={i} tone="accent">
          {l}
        </TerminalLine>
      ))}
    </div>
  );
}
