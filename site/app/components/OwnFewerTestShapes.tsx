/** The collaborator boundary distinguishes social and solitary test shapes. */
export default function OwnFewerTestShapes() {
  return (
    <div className="rounded-2xl border border-hairline bg-panel px-4 py-7 sm:px-8 sm:py-9">
      <svg
        viewBox="0 0 840 280"
        className="h-auto w-full"
        role="img"
        aria-label="A social test keeps two real collaborators connected to the subject. A solitary test cuts those joins at the subject boundary."
      >
        <text x="188" y="24" fill="#8f8580" fontSize="11" fontFamily="var(--font-mono)" letterSpacing="2" textAnchor="middle">
          SOCIAL
        </text>
        <text x="652" y="24" fill="#8f8580" fontSize="11" fontFamily="var(--font-mono)" letterSpacing="2" textAnchor="middle">
          SOLITARY
        </text>

        <path d="M420 52v196" stroke="#383e41" strokeWidth="1" />

        <path d="M76 140h92" stroke="#f3f4f6" strokeWidth="2" />
        <path d="m158 133 10 7-10 7" fill="none" stroke="#f3f4f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M244 140C292 140 292 92 338 92M244 140c48 0 48 48 94 48" fill="none" stroke="#756d67" strokeWidth="2" />

        <path d="M48 140 62 126 76 140 62 154Z" fill="#f3f4f6" />
        <circle cx="206" cy="140" r="39" fill="#181b1d" stroke="#f3f4f6" strokeWidth="2" />
        <rect x="338" y="70" width="54" height="44" rx="6" fill="#181b1d" stroke="#756d67" strokeWidth="2" />
        <rect x="338" y="166" width="54" height="44" rx="6" fill="#181b1d" stroke="#756d67" strokeWidth="2" />

        <path d="M540 140h74" stroke="#f3f4f6" strokeWidth="2" />
        <path d="m604 133 10 7-10 7" fill="none" stroke="#f3f4f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M690 140C724 140 724 92 752 92M690 140c34 0 34 48 62 48" fill="none" stroke="#756d67" strokeWidth="2" opacity="0.7" />

        <path d="M512 140 526 126 540 140 526 154Z" fill="#f3f4f6" />
        <circle cx="652" cy="140" r="39" fill="#181b1d" stroke="#ff4a19" strokeWidth="2" />
        <path d="M722 78v124" stroke="#ff4a19" strokeWidth="2" />
        <circle cx="722" cy="92" r="4" fill="#ff4a19" />
        <circle cx="722" cy="188" r="4" fill="#ff4a19" />
        <rect x="752" y="70" width="54" height="44" rx="6" fill="#181b1d" stroke="#756d67" strokeWidth="2" opacity="0.35" />
        <rect x="752" y="166" width="54" height="44" rx="6" fill="#181b1d" stroke="#756d67" strokeWidth="2" opacity="0.35" />
      </svg>
    </div>
  );
}
