type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? "size-4"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></Icon>;
}

export function MoonIcon(props: IconProps) {
  return <Icon {...props}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" /></Icon>;
}

export function HistoryIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Icon>;
}

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h6M14 18h6" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="12" cy="18" r="2" /></Icon>;
}

export function AvatarPositionIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 3v18M3 12h18" /><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></Icon>;
}

export function SendIcon(props: IconProps) {
  return <Icon {...props}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon>;
}

/** Return key (⏎), the send glyph used by Claude Code's composer. */
export function ReturnIcon(props: IconProps) {
  return <Icon {...props}><path d="M9 10l-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function MicrophoneIcon(props: IconProps) {
  return <Icon {...props}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></Icon>;
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

export function ChevronLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="m15 18-6-6 6-6" /></Icon>;
}

export function ChevronRightIcon(props: IconProps) {
  return <Icon {...props}><path d="m9 18 6-6-6-6" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>;
}

export function GlobeIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" /></Icon>;
}

export function WaveformIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 10.5v3M7 7v10M11 4v16M15 8v8M19 6v12" /></Icon>;
}

export function SmileIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></Icon>;
}

export function BotIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 8V4.5" /><circle cx="12" cy="3.5" r="1" /><rect x="4" y="8" width="16" height="12" rx="4" /><path d="M2 13.5v2M22 13.5v2M9 13v1.5M15 13v1.5" /></Icon>;
}

export function ServerIcon(props: IconProps) {
  return <Icon {...props}><rect x="3" y="3.5" width="18" height="7" rx="2.5" /><rect x="3" y="13.5" width="18" height="7" rx="2.5" /><path d="M7 7h.01M7 17h.01" /></Icon>;
}

export function ShieldIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 21c-4.5-1.6-7.5-4.6-7.5-9.2V5.8L12 3l7.5 2.8v6c0 4.6-3 7.6-7.5 9.2Z" /><path d="m9 12 2.2 2.2L15.5 10" /></Icon>;
}

export function LogoutIcon(props: IconProps) {
  return <Icon {...props}><path d="M9.5 20.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5h3.5" /><path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9" /></Icon>;
}

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
}

export function SearchIcon(props: IconProps) {
  return <Icon {...props}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Icon>;
}

export function MoreIcon(props: IconProps) {
  return <Icon {...props}><circle cx="5.5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18.5" cy="12" r="1" /></Icon>;
}

export function MinusIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 12h14" /></Icon>;
}

export function ResetIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" /><path d="M4 4v4.6h4.6" /></Icon>;
}
