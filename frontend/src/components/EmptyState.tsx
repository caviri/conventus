// A soft, Ghibli-ish empty state: a little sprout breaking ground under a sun.
function Sprout() {
  return (
    <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
      <circle cx="74" cy="30" r="16" fill="var(--c-sun)" opacity="0.35" />
      <circle cx="74" cy="30" r="9" fill="var(--c-sun)" opacity="0.85" />
      <ellipse cx="52" cy="86" rx="34" ry="8" fill="var(--c-accent-soft)" />
      <path
        d="M52 86 C52 66 52 58 52 48"
        stroke="var(--c-accent-2)"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M52 60 C40 58 31 61 28 52 C37 47 47 50 52 58 Z" fill="var(--c-accent-2)" />
      <path d="M52 54 C64 50 73 53 76 44 C67 39 55 42 52 52 Z" fill="var(--c-accent)" />
      <circle cx="52" cy="46" r="4.5" fill="var(--c-accent)" />
    </svg>
  );
}

export default function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center fade-in">
      <Sprout />
      <div className="font-display text-lg">{title}</div>
      {subtitle && (
        <div className="max-w-xs text-sm text-[var(--c-muted)]">{subtitle}</div>
      )}
    </div>
  );
}
