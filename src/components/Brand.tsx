import { useId } from "react";
import { cx } from "../lib/format";

export function BrandMark({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bgId = `zenbg-${uid}`;
  const rimId = `zenrim-${uid}`;
  const beamId = `zenbeam-${uid}`;

  return (
    <svg viewBox="0 0 32 32" fill="none" className={cx("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1d1713" />
          <stop offset="1" stopColor="#0b0908" />
        </linearGradient>
        <linearGradient id={rimId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffc372" stopOpacity="0.26" />
          <stop offset="1" stopColor="#f0a640" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id={beamId} x1="23.5" y1="8.5" x2="8.5" y2="23.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffe0ad" />
          <stop offset="0.5" stopColor="#f0a640" />
          <stop offset="1" stopColor="#d47218" />
        </linearGradient>
      </defs>
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8.5"
        fill={`url(#${bgId})`}
        stroke={`url(#${rimId})`}
        strokeWidth="1"
      />
      <path d="M8.5 8.5H21.2L18.8 11.7H8.5V8.5Z" fill="#f5ede2" fillOpacity="0.92" />
      <path d="M13.2 20.3H23.5V23.5H10.8L13.2 20.3Z" fill="#f5ede2" fillOpacity="0.92" />
      <path d="M19.3 8.5H23.5L12.7 23.5H8.5L19.3 8.5Z" fill={`url(#${beamId})`} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "font-[var(--font-title)] text-[1.4rem] font-normal leading-none tracking-[-0.015em] text-fg whitespace-nowrap",
        className,
      )}
    >
      Zenova
    </span>
  );
}
