export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} role="img" aria-label="교회 출결" viewBox="0 0 48 48">
      <path
        d="M11 7v34M5 16h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M25 8 40 13v28l-15-5V8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M25 8v28M32 24h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M25 36 40 41"
        fill="none"
        stroke="var(--brand-gold)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <div className="flex items-center gap-3 text-primary">
      <BrandMark className="size-10" />
      <strong className="text-xl font-bold">교회 출결</strong>
    </div>
  );
}
