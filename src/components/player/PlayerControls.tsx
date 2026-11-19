import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cx, formatClock } from "../../lib/format";
import type { ProfileSettings } from "../../lib/types";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const SUBS: Array<{ id: ProfileSettings["subtitles"]; label: string }> = [
  { id: "off", label: "Desactivados" },
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];

export type Panel = "episodes" | "servers" | "subs" | "speed" | null;

export function Scrubber({
  pct,
  duration,
  onSeek,
}: {
  pct: number;
  duration: number;
  onSeek: (fraction: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const fraction = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const shown = drag !== null ? drag * 100 : pct;

  return (
    <div
      ref={bar}
      className="group/scrub relative flex h-5 cursor-pointer items-center"
      onMouseMove={(e) => setHoverX(fraction(e.clientX))}
      onMouseLeave={() => setHoverX(null)}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(fraction(e.clientX));
      }}
      onPointerMove={(e) => drag !== null && setDrag(fraction(e.clientX))}
      onPointerUp={(e) => {
        if (drag !== null) onSeek(fraction(e.clientX));
        setDrag(null);
      }}
      role="slider"
      aria-label="Progreso"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="relative h-1.5 w-full">
        <div className="absolute inset-0 origin-center scale-y-[0.67] overflow-hidden rounded-full bg-white/25 transition-transform duration-300 ease-[var(--ease-spring)] group-hover/scrub:scale-y-100">
          {hoverX !== null && (
            <div
              className="absolute inset-0 origin-left bg-white/25"
              style={{ transform: `scaleX(${hoverX})` }}
            />
          )}
          <div
            className="absolute inset-0 origin-left bg-accent"
            style={{ transform: `scaleX(${shown / 100})` }}
          />
        </div>
        <div
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-accent ring-4 ring-accent/25 transition-transform duration-300 ease-[var(--ease-spring)] group-hover/scrub:scale-100"
          style={{ left: `${shown}%` }}
        />
      </div>
      {hoverX !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-xs font-bold tabular-nums"
          style={{ left: `${hoverX * 100}%` }}
        >
          {formatClock(hoverX * duration)}
        </div>
      )}
    </div>
  );
}

export function CtrlButton({
  label,
  onClick,
  children,
  active,
  wide,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  wide?: boolean;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        "flex h-11 items-center justify-center gap-2 rounded-full transition-colors",
        wide ? "px-3" : "w-11",
        active ? "text-accent" : "text-fg hover:bg-white/10",
      )}
    >
      {children}
    </motion.button>
  );
}

export function Popover({
  open,
  title,
  children,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="glass absolute right-0 bottom-14 z-20 w-60 rounded-2xl refract p-2 shadow-2xl"
        >
          <div className="px-3 pt-2 pb-2 text-xs font-bold tracking-wider text-dim uppercase">
            {title}
          </div>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PopItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-white/10",
        active ? "text-fg" : "text-muted",
      )}
    >
      {children}
      {active && <Check className="size-4 text-accent" />}
    </button>
  );
}
