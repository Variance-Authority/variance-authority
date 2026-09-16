import type { ReactNode } from "react";

const MOVES = [
  { key: "faster", title: "Faster", claim: "Keep the page open" },
  { key: "stabler", title: "Stabler", claim: "Trace the state change" },
  { key: "smarter", title: "Smarter", claim: "Choose from the run" },
  { key: "cheaper", title: "Cheaper", claim: "Remove unused work" },
] as const;

function FasterIcon() {
  return (
    <svg viewBox="0 0 96 96" className="h-16 w-16" aria-hidden="true">
      <rect x="18" y="23" width="60" height="46" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M18 34h60M25 28h2m5 0h2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M35 54h24" fill="none" stroke="#ff4a19" strokeWidth="4" strokeLinecap="round" />
      <path d="M63 47a13 13 0 1 1-3-8" fill="none" stroke="#756d67" strokeWidth="2.5" strokeLinecap="round" />
      <path d="m59 35 4 4-5 3" fill="none" stroke="#756d67" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StablerIcon() {
  return (
    <svg viewBox="0 0 96 96" className="h-16 w-16" aria-hidden="true">
      <path d="M24 27h18l9 13h21M24 69h18l9-13h21" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="27" r="5" fill="#24282a" stroke="#756d67" strokeWidth="2" />
      <circle cx="24" cy="69" r="5" fill="#24282a" stroke="#756d67" strokeWidth="2" />
      <circle cx="73" cy="40" r="7" fill="#ff4a19" />
      <circle cx="73" cy="56" r="7" fill="#7fa28c" />
    </svg>
  );
}

function SmarterIcon() {
  return (
    <svg viewBox="0 0 96 96" className="h-16 w-16" aria-hidden="true">
      <circle cx="25" cy="29" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="25" cy="67" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="48" cy="48" r="6" fill="#ff4a19" />
      <circle cx="73" cy="31" r="5" fill="none" stroke="#756d67" strokeWidth="2" />
      <circle cx="73" cy="65" r="5" fill="#7fa28c" />
      <path d="m30 31 13 13m-13 20 13-12m11-1 14 11M54 45l14-11" fill="none" stroke="#756d67" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheaperIcon() {
  return (
    <svg viewBox="0 0 96 96" className="h-16 w-16" aria-hidden="true">
      <path d="M22 28h52M22 48h38M22 68h24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <circle cx="74" cy="28" r="6" fill="#756d67" />
      <circle cx="60" cy="48" r="6" fill="#ff4a19" />
      <circle cx="46" cy="68" r="6" fill="#7fa28c" />
      <path d="m69 63 5 5 9-11" fill="none" stroke="#7fa28c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS: Record<(typeof MOVES)[number]["key"], ReactNode> = {
  faster: <FasterIcon />, stabler: <StablerIcon />, smarter: <SmarterIcon />, cheaper: <CheaperIcon />,
};

/** Four moves held together by one strategy: retain useful work and evidence. */
export default function BetterTests() {
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-panel px-5 py-8 sm:px-8">
      <div className="text-center">
        <p className="!m-0 font-mono text-[10px] tracking-[0.18em] text-orange uppercase">better tests</p>
        <p className="!m-0 pt-2 text-xl font-bold tracking-tight text-ivory sm:text-2xl">Keep the work. Keep the evidence.</p>
      </div>

      <div className="mt-8 grid grid-cols-2 sm:mt-10 lg:grid-cols-4">
        {MOVES.map((move, index) => (
          <section
            key={move.key}
            className={`relative px-3 py-5 text-center sm:px-5 ${
              index % 2 === 1 ? "border-l border-hairline" : ""
            } ${index > 1 ? "border-t border-hairline lg:border-t-0" : ""} ${
              index > 0 ? "lg:border-l lg:border-hairline" : "lg:border-l-0"
            }`}
          >
            <div className="mx-auto flex h-20 w-20 items-center justify-center text-ivory">{ICONS[move.key]}</div>
            <h3 className="!m-0 pt-4 text-lg font-bold tracking-tight text-ivory">{move.title}</h3>
            <p className="!m-0 pt-2 text-xs leading-5 text-quiet sm:text-sm">{move.claim}</p>
          </section>
        ))}
      </div>

      <div className="mx-auto mt-7 flex max-w-md items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-hairline" />
        <span className="h-2 w-2 rotate-45 bg-orange" />
        <span className="h-px flex-1 bg-hairline" />
      </div>
      <p className="!m-0 pt-4 text-center text-sm text-quiet">One run improves the next.</p>
    </div>
  );
}
