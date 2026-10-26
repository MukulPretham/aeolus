/** Minimal wind-mark: three tapered bands, amber gradient. Pure SVG, no assets. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="aeolus-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f5a623" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="11" fill="#0f1620" stroke="#24313f" />
      <g fill="none" stroke="url(#aeolus-mark)" strokeLinecap="round">
        <path d="M9 14.5h13.5c2.6 0 4.2-1.6 4.2-3.6S25.1 7.3 22.5 7.3" strokeWidth="2.6" />
        <path d="M9 20.5h20" strokeWidth="2.6" />
        <path d="M9 26.5h13.5c2.6 0 4.2 1.6 4.2 3.6s-1.6 3.6-4.2 3.6" strokeWidth="2.6" opacity="0.75" />
      </g>
    </svg>
  )
}
