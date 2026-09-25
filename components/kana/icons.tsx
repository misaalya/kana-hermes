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

/**
 * Header tab and settings section glyphs: solid, two-tone shapes in the
 * current colour, the main part at full strength and the supporting part in
 * the soft tone, like the console-menu icons they follow. The soft part is one
 * element or group so overlapping fill and stroke never double its opacity.
 */
function DuoIcon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" className={className ?? "size-5"} viewBox="0 0 24 24" fill="currentColor">
      {children}
    </svg>
  );
}

const SOFT = 0.5;

export function SunIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <path
        opacity={SOFT}
        d="M12 1.8v2.4M12 19.8v2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M1.8 12h2.4M19.8 12h2.4M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="5" />
    </DuoIcon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <path d="M20.6 14.2A8.9 8.9 0 1 1 9.8 3.4a7.1 7.1 0 0 0 10.8 10.8Z" />
      <path opacity={SOFT} d="M17 2.6l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8ZM20.7 8.6l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5Z" />
    </DuoIcon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <circle opacity={SOFT} cx="12" cy="12" r="9.8" />
      <path d="M12 6.6v5.6l3.8 2.3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </DuoIcon>
  );
}

export function SettingsIcon(props: IconProps) {
  const hexagon = "M12 3 19.8 7.5V16.5L12 21 4.2 16.5V7.5Z";
  return (
    <DuoIcon {...props}>
      <path opacity={SOFT} d={hexagon} stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.6" />
    </DuoIcon>
  );
}

/** The avatar layout tab: a small box growing into a big one, for scale. */
export function AvatarPositionIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <rect opacity={SOFT} x="2.5" y="2.5" width="19" height="19" rx="5" />
      <rect x="5.5" y="11.5" width="7" height="7" rx="2" />
      <path d="M12.5 11.5 18 6M13.6 6H18v4.4" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </DuoIcon>
  );
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
  return (
    <DuoIcon {...props}>
      <circle opacity={SOFT} cx="12" cy="12" r="9.8" />
      <path
        d="M3.2 12h17.6M12 2.6c-2.6 2.6-3.9 5.7-3.9 9.4s1.3 6.8 3.9 9.4c2.6-2.6 3.9-5.7 3.9-9.4S14.6 5.2 12 2.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </DuoIcon>
  );
}

export function WaveformIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <g opacity={SOFT}>
        <rect x="2" y="9.5" width="3" height="5" rx="1.5" />
        <rect x="19" y="8" width="3" height="8" rx="1.5" />
      </g>
      <rect x="6.25" y="6" width="3" height="12" rx="1.5" />
      <rect x="10.5" y="2.5" width="3" height="19" rx="1.5" />
      <rect x="14.75" y="7.5" width="3" height="9" rx="1.5" />
    </DuoIcon>
  );
}

/** The avatar settings section: Kana's figure, head and shoulders. */
export function AvatarIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <circle cx="12" cy="7.2" r="4.2" />
      <rect opacity={SOFT} x="3.8" y="13.2" width="16.4" height="8.6" rx="4.3" />
    </DuoIcon>
  );
}

export function BotIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <rect opacity={SOFT} x="3.5" y="7.5" width="17" height="13.5" rx="4.6" />
      <path d="M12 7.5V4.8" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="12" cy="3.6" r="1.9" />
      <rect x="0.8" y="11.8" width="2.2" height="5" rx="1.1" />
      <rect x="21" y="11.8" width="2.2" height="5" rx="1.1" />
      <rect x="7.9" y="11.6" width="2.7" height="4" rx="1.35" />
      <rect x="13.4" y="11.6" width="2.7" height="4" rx="1.35" />
    </DuoIcon>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <g opacity={SOFT}>
        <rect x="2.5" y="3" width="19" height="7.8" rx="3" />
        <rect x="2.5" y="13.2" width="19" height="7.8" rx="3" />
      </g>
      <circle cx="7" cy="6.9" r="1.6" />
      <circle cx="7" cy="17.1" r="1.6" />
      <path d="M11.5 6.9h6M11.5 17.1h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </DuoIcon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <path opacity={SOFT} d="M12 21.8c-5-1.7-8.4-5.1-8.4-10.2V5.3L12 2.2l8.4 3.1v6.3c0 5.1-3.4 8.5-8.4 10.2Z" />
      <path d="m8.3 12.1 2.6 2.6 4.9-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </DuoIcon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <DuoIcon {...props}>
      <rect opacity={SOFT} x="2.5" y="2.5" width="11.5" height="19" rx="3.4" />
      <path d="M9.5 12h11M16.6 7.9 20.7 12l-4.1 4.1" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </DuoIcon>
  );
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
