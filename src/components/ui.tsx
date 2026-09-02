import type { ReactNode } from "react";
import { useState, useRef, useEffect } from "react";
import { Icon } from "./icons";
import { useApp } from "../store";

export function Row({ label, children, hint }: { label: string; children?: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <div className="text-[11.5px] muted shrink-0" title={hint}>
        {label}
      </div>
      <div className="flex items-center gap-1 min-w-0">{children}</div>
    </div>
  );
}

export function Num({
  value,
  onChange,
  step = 1,
  min,
  max,
  w = 74,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  w?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        className="inp text-right"
        style={{ width: w }}
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      {suffix && <span className="text-[10px] muted">{suffix}</span>}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button className={"chip " + (on ? "on" : "off")} onClick={() => onChange(!on)}>
      {label ?? (on ? "开" : "关")}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((o) => (
        <button key={o.id} className={"chip " + (value === o.id ? "on" : "")} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b hairline">
      <div className="flex items-center justify-between px-2 py-[6px] cursor-pointer select-none" onClick={() => setOpen(!open)}>
        <div className="text-[11.5px] font-semibold">
          <span className="muted mr-1">{open ? "▾" : "▸"}</span>
          {title}
        </div>
        <div onClick={(e) => e.stopPropagation()}>{right}</div>
      </div>
      {open && <div className="px-2 pb-2 fade">{children}</div>}
    </div>
  );
}

export function Modal({ title, children, onClose, width = 520 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,.5)" }} onClick={onClose}>
      <div className="card fade max-h-[86vh] flex flex-col" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b hairline">
          <div className="text-[13px] font-semibold">{title}</div>
          <button className="btn sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-3 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-8 h-6 rounded border hairline bg-transparent cursor-pointer"
    />
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "pro" | "beta" | "ok" | "warn" }) {
  const map: Record<string, string> = {
    muted: "border-[var(--line)] text-[var(--muted)]",
    pro: "border-amber-500 text-amber-400",
    beta: "border-sky-500 text-sky-400",
    ok: "border-emerald-500 text-emerald-400",
    warn: "border-rose-500 text-rose-400",
  };
  return <span className={`inline-block px-[6px] py-[1px] rounded-full border text-[10px] ${map[tone]}`}>{children}</span>;
}

/** 命令按钮：线性 SVG 图标 + 图标下方中文小字 */
export function Tool({ icon, label, on, onClick, title }: { icon: string; label: string; on?: boolean; onClick?: () => void; title?: string }) {
  const { iconSize, showIconLabel } = useApp((s) => s.settings);
  return (
    <button className={"tool " + (on ? "on" : "")} onClick={onClick} title={title || label}>
      <span className="ic flex items-center justify-center" style={{ height: iconSize + 2 }}>
        <Icon name={icon} size={iconSize} />
      </span>
      {showIconLabel && <span>{label}</span>}
    </button>
  );
}

/** 图标按钮（无文字） */
export function IconBtn({ icon, title, on, onClick, size = 16 }: { icon: string; title?: string; on?: boolean; onClick?: () => void; size?: number }) {
  return (
    <button className={"btn sm " + (on ? "active" : "")} title={title} onClick={onClick} style={{ padding: "5px 7px" }}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/** ⋮ 更多菜单（右上角三点） */
export function MoreMenu({ children, width = 300, icon = "more", title = "更多" }: { children: ReactNode; width?: number; icon?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className={"btn sm " + (open ? "active" : "")} title={title} onClick={() => setOpen(!open)} style={{ padding: "5px 7px" }}>
        <Icon name={icon} size={17} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-[30px] card fade z-50 max-h-[74vh] overflow-auto"
          style={{ width, boxShadow: "0 12px 40px rgba(0,0,0,.5)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, label, hint, onClick, right }: { icon?: string; label: string; hint?: string; onClick?: () => void; right?: ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-[7px] cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={16} />}
      <div className="flex-1 min-w-0">
        <div className="text-[12px]">{label}</div>
        {hint && <div className="text-[10.5px] muted truncate">{hint}</div>}
      </div>
      {right}
    </div>
  );
}

export function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b hairline py-1">
      <div className="px-3 py-[3px] text-[10.5px] muted tracking-wide">{title}</div>
      <div className="px-1">{children}</div>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
      <div className="h-full" style={{ width: `${Math.round(value * 100)}%`, background: "var(--accent)", transition: "width .15s" }} />
    </div>
  );
}
