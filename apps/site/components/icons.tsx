import type { CSSProperties } from "react";

type IconProps = {
  className?: string;
  style?: CSSProperties;
};

export function ArrowUpRight({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WindowsMark({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.6 10.4 4.5v7H3v-5.9Zm8.8-1.2L21 3.2v8.3h-9.2V4.4ZM3 12.8h7.4v7L3 18.6v-5.8Zm8.8 0H21v8l-9.2-1.3v-6.7Z" />
    </svg>
  );
}

export function AndroidMark({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M7.2 17.5V11a4.8 4.8 0 0 1 9.6 0v6.5" strokeLinecap="round" />
      <path d="M7.2 17.5h9.6" strokeLinecap="round" />
      <path d="M8.6 6.4 7.2 3.9M15.4 6.4l1.4-2.5" strokeLinecap="round" />
      <circle cx="10.2" cy="11.4" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="13.8" cy="11.4" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ShieldMark({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M12 3.2 19 6v5.5c0 4.3-2.9 7.4-7 9.3-4.1-1.9-7-5-7-9.3V6l7-2.8Z" strokeLinejoin="round" />
      <path d="m9 12 2.2 2.2L15.4 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" strokeLinecap="round" />
    </svg>
  );
}
