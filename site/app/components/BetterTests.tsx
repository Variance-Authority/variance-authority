import type { ReactNode } from "react";

const MOVES = [
  {
    key: "faster",
    title: "Faster",
    claim: "Reuse the world already open",
    detail: "one browser · one page · switch in place",
  },
  {
    key: "stabler",
    title: "Stabler",
    claim: "Name what made the state move",
    detail: "drift · shared state · source",
  },
  {
    key: "smarter",
    title: "Smarter",
    claim: "Choose from recorded evidence",
    detail: "source reach · execution · distance",
  },
  {
    key: "cheaper",
    title: "Cheaper",
    claim: "Remove work nothing exercises",
    detail: "imports · setup · dependencies",
  },
] as const;

function FasterIcon() {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20" aria-hidden="true">
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
    <svg viewBox="0 0 96 96" className="h-20 w-20" aria-hidden="true">
      <path d="M24 27h18l9 13h21M24 69h18l9-13h21" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="27" r="5" fill="#24282a" stroke="#756d67" strokeWidth="2" />
      <circle cx="24" cy="69" r="5" fill="#24282a" stroke="#756d67" strokeWidth="2" />
      <circle cx="73" cy="40" r="7" fill="#ff4a19" />
      <circle cx="73" cy="56" r="7" fill="#7fa28c" />
      <path d="M69 40h8M73 36v8" stroke="#181b1d" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m69 56 3 3 5-6" fill="none" stroke="#181b1d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SmarterIcon() {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20" aria-hidden="true">
      <circle cx="25" cy="29" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="25" cy="67" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="48" cy="48" r="6" fill="#ff4a19" />
      <circle cx="73" cy="31" r="5" fill="none" stroke="#756d67" strokeWidth="2" />
      <circle cx="73" cy="65" r="5" fill="#7fa28c" />
      <path d="m30 31 13 13m-13 20 13-12m11-1 14 11M54 45l14-11" fill="none" stroke="#756d67" strokeWidth="2" strokeLinecap="round" />
      <path d="M44 48h8" stroke="#181b1d" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheaperIcon() {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20" aria-hidden="true">
      <path d="M22 28h52M22 48h38M22 68h24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <circle cx="74" cy="28" r="6" fill="#756d67" />
      <circle cx="60" cy="48" r="6" fill="#ff4a19" />
      <circle cx="46" cy="68" r="6" fill="#7fa28c" />
      <path d="m69 63 5 5 9-11" fill="none" stroke="#7fa28c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS: Record<(typeof MOVES)[number]["key"], ReactNode> = {
  faster: <FasterIcon />,
  stabler: <StablerIcon />,
  smarter: <SmarterIcon />,
  cheaper: <CheaperIcon />,
};

/** Four improvements that reinforce one another through the same retained evidence. */
export default function BetterTests() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-hairline bg-panel px-5 py-7 sm:px-7">
      <div className="absolute inset-x-[12%] top-[5.55rem] hidden h-px bg-hairline lg:block" aria-hidden="true" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-6 lg:grid-cols-4 lg:gap-4">
        {MOVES.map((move, index) => (
          <section key={move.key} className="relative text-center">
            <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
              {String(index + 1).padStart(2, "0")}
            </p>
            <div className="relative z-10 mx-auto mt-3 flex h-24 w-24 items-center justify-center rounded-full border border-hairline bg-deep text-ivory">
              {ICONS[move.key]}
            </div>
            <h3 className="mt-5 text-xl font-bold tracking-tight text-ivory">
              {move.title}
            </h3>
            <p className="mx-auto mt-2 max-w-[14rem] text-sm leading-6 text-quiet">
              {move.claim}
            </p>
            <p className="mt-3 font-mono text-[9px] leading-4 tracking-[0.08em] text-warm uppercase">
              {move.detail}
            </p>
          </section>
        ))}
      </div>
      <div className="mx-auto mt-8 flex max-w-xl items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-hairline" />
        <span className="h-2 w-2 rotate-45 bg-orange" />
        <span className="h-px flex-1 bg-hairline" />
      </div>
      <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-6 text-quiet">
        Reuse creates the speed. Diagnosis makes reuse trustworthy. Recorded
        execution chooses the next work. Removing unused dependencies leaves
        less work to choose.
      </p>
    </div>
  );
}
