/* One set of line icons for the whole app (24px grid, 1.8 stroke, currentColor), so no screen needs an emoji. */
const P: Record<string, React.ReactNode> = {
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  graduation: <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5" /><path d="M22 9v5" /></>,
  headphones: <><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M3 13h18" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="M9 12h6M9 16h4" /></>,
  scales: <><path d="M12 4v16M7 20h10" /><path d="M5 7h14" /><path d="M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z" /></>,
  bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="m7 15 4-4 3 3 5-6" /></>,
  map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  rupee: <><path d="M7 5h11M7 9h11" /><path d="M7 5h3a4 4 0 0 1 0 8H7l8 7" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  school: <><path d="M3 10 12 4l9 6" /><path d="M5 10v9h14v-9" /><path d="M10 19v-5h4v5" /></>,
  pencil: <><path d="M4 20l1-4L16 5l3 3L8 19z" /><path d="m14 7 3 3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7" /></>,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  warning: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.5" /></>,
  star: <><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></>,
  pin: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  send: <><path d="M21 3 3 10.5l7 3 3 7z" /><path d="m10 13.5 4-4" /></>,
  speaker: <><path d="M4 9.5v5h4l5 4v-13l-5 4z" /><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></>,
  flag: <><path d="M5 21V4M5 5h12l-2 4 2 4H5" /></>,
  wrench: <><path d="M14.5 6.5a4 4 0 0 0 4.9 4.9L21 13l-3 3-2.6-2.6L7 22l-3-3 8.6-8.4A4 4 0 0 1 14.5 6.5z" /></>,
  train: <><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 11h14M9 21l2-4M15 21l-2-4" /><circle cx="9" cy="14" r=".6" /><circle cx="15" cy="14" r=".6" /></>,
  factory: <><path d="M3 20V9l6 4V9l6 4V5h6v15z" /></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16v4M17 18h4" /></>,
  bank: <><path d="M3 9l9-5 9 5z" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /></>,
  trophy: <><path d="M8 4h8v6a4 4 0 0 1-8 0z" /><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 14v4M8 20h8" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  hourglass: <><path d="M7 3h10M7 21h10" /><path d="M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9" /></>,
  refresh: <><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" /><path d="M18 3v4h-4M6 21v-4h4" /></>,
  home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /></>,
  gift: <><rect x="4" y="9" width="16" height="11" rx="1" /><path d="M3 9h18M12 9v11M12 9c-3 0-4-4-1.5-4S12 9 12 9zM12 9c3 0 4-4 1.5-4S12 9 12 9z" /></>,
  offline: <><path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 3-2M19 13a10 10 0 0 0-5.5-3" /><circle cx="12" cy="19.5" r=".6" /></>,
  download: <><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14" /></>,
  stop: <><rect x="6" y="6" width="12" height="12" rx="2" /></>,
  family: <><circle cx="8" cy="7" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M2 20a6 6 0 0 1 12 0M14.5 20a4.5 4.5 0 0 1 7.5-3.4" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l3 3" /></>,
  satellite: <><path d="M4 20a12 12 0 0 1 12-12M4 14a6 6 0 0 1 6-6" /><circle cx="5" cy="19" r="1.2" /><path d="M14 4l6 6" /></>,
  puzzle: <><path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4z" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.5M4 12h.5M4 18h.5" /></>,
  arrowright: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  seed: <><path d="M12 21v-9" /><path d="M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-3 2-5 6-5 0 3-2 5-6 5z" /></>,
  card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
  scooter: <><circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M8.5 17H14l3-9h2M14 17l-2-6H8" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>,
  face: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.5M15 9.5v.5" /></>,
  bus: <><rect x="4" y="4" width="16" height="13" rx="3" /><path d="M4 12h16M7 20v-3M17 20v-3" /></>,
  dna: <><path d="M7 3c0 6 10 6 10 12v6M17 3c0 6-10 6-10 12v6M8 7h8M8 17h8" /></>,
  sunrise: <><path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 6v3M4.5 11l2 1.5M19.5 11l-2 1.5" /></>,
  logout: <><path d="M10 4H5v16h5" /><path d="M9 12h11M16 8l4 4-4 4" /></>,
  tool: <><path d="M14.5 6.5a4 4 0 0 0 4.9 4.9L21 13l-3 3-2.6-2.6L7 22l-3-3 8.6-8.4A4 4 0 0 1 14.5 6.5z" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, className = "", strokeWidth = 1.8 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  const body = P[name] ?? P.info;
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 ${className}`}>{body}</svg>
  );
}

/** A tick, cross, or warning mark that is never colour alone: pairs the icon with the word the caller shows next to it. */
export function Mark({ kind, size = 16 }: { kind: "yes" | "no" | "warn" | "info" | "unknown"; size?: number }) {
  const m = { yes: ["check", "text-[var(--good)]"], no: ["x", "text-[var(--bad)]"], warn: ["warning", "text-amber-600"], info: ["info", "text-[var(--muted)]"], unknown: ["question", "text-[var(--muted)]"] }[kind];
  return <Icon name={m[0]} size={size} className={`align-[-3px] ${m[1]}`} />;
}
