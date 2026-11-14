/** A small neutral mark (a shell prompt in a rounded square). Not anyone's trademark. */
export function GfvMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1" width="14" height="14" rx="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.5 6l2.5 2-2.5 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 10.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
