"use client";

import { useRef, useState } from "react";

/**
 * The HTML report's subject viewer, at the size a documentation figure has.
 * Three pictures side by side is where every self-hosted report stops, and it
 * is the point at which a four-pixel shift becomes invisible — so the page is
 * the comparison rather than an arrangement of it, and `regions` leads,
 * because which boxes moved and who owns them is the question a screenshot
 * cannot answer.
 */

const MODES = ["regions", "wipe", "blend", "blink"] as const;
type Mode = (typeof MODES)[number];

/** Boxes in the mock's own coordinate space, as percentages of the frame. */
const REGIONS = [
  {
    box: "Checkout / summary",
    owner: "Total",
    at: "src/checkout/Total.tsx:41",
    style: { left: "4%", top: "60%", width: "50%", height: "15%" },
  },
  {
    box: "Checkout / actions",
    owner: "Button",
    at: "src/ui/Button.tsx:18",
    style: { left: "62%", top: "59%", width: "34%", height: "16%" },
  },
] as const;

/**
 * The mock subject: the same page before and after a spacing token changed. Laid
 * out in absolute percentages rather than flow, so the region boxes above can
 * be authored against the same coordinates the shot draws in.
 */
function Shot({ after }: { after: boolean }) {
  /** The edit: everything below the copy sits lower in the after reading. */
  const shift = after ? 1.2 : 0;
  const bar = "absolute rounded-sm transition-[top] duration-500";
  return (
    <div className="absolute inset-0 bg-charcoal">
      <span
        className={`${bar} bg-ivory/70`}
        style={{ left: "6%", top: "9%", width: "30%", height: "6%" }}
      />
      <span
        className={`${bar} bg-quiet/45`}
        style={{ left: "6%", top: "24%", width: "62%", height: "3.5%" }}
      />
      <span
        className={`${bar} bg-quiet/35`}
        style={{ left: "6%", top: "30%", width: "50%", height: "3.5%" }}
      />
      {[41, 48.5, 56].map((top) => (
        <span
          key={top}
          className={`${bar} bg-quiet/20`}
          style={{
            left: "6%",
            top: `${top + shift}%`,
            width: "72%",
            height: "4.5%",
          }}
        />
      ))}
      <span
        className={`${bar} bg-quiet/40`}
        style={{
          left: "6%",
          top: `${66 + shift}%`,
          width: "34%",
          height: "5%",
        }}
      />
      <span
        className={`${bar} bg-orange/70`}
        style={{
          left: "64%",
          top: `${63 + shift}%`,
          width: "30%",
          height: "9%",
        }}
      />
      <span
        className={`${bar} bg-quiet/15`}
        style={{
          left: "6%",
          top: `${82 + shift}%`,
          width: "46%",
          height: "3.5%",
        }}
      />
    </div>
  );
}

export default function DiffReport() {
  const [mode, setMode] = useState<Mode>("regions");
  const [seam, setSeam] = useState(52);
  const [blend, setBlend] = useState(50);
  const [hot, setHot] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  /** The wipe's seam follows the pointer, which is the whole interaction. */
  function track(e: React.PointerEvent) {
    if (mode !== "wipe") return;
    const r = frame.current?.getBoundingClientRect();
    if (!r) return;
    setSeam(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  }

  return (
    <div className="rounded-2xl border border-hairline bg-panel p-5 sm:p-7">
      <div className="mb-5 grid gap-3 rounded-xl border border-hairline bg-deep p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-orange">
            1 cause · 11 affected states
          </p>
          <p className="mt-1 text-sm text-ivory">
            Button spacing · token and geometry evidence
          </p>
        </div>
        <p className="font-mono text-[11px] text-warm">
          8 exact repeats · 3 additional
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors ${
              mode === m
                ? "border-orange/60 bg-orange/[0.08] text-orange"
                : "border-hairline text-quiet hover:border-warm hover:text-ivory"
            }`}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-warm">
          story:checkout--default
        </span>
      </div>

      <div
        ref={frame}
        onPointerMove={track}
        className={`relative mx-auto mt-4 aspect-[16/11] w-full max-w-2xl overflow-hidden rounded-xl border border-hairline bg-deep ${
          mode === "wipe" ? "cursor-ew-resize" : ""
        }`}
      >
        {/* before, under everything */}
        <Shot after={false} />

        {/* after, revealed by whichever mode is on */}
        <div
          className={
            mode === "blink" ? "vr-blink absolute inset-0" : "absolute inset-0"
          }
          style={{
            clipPath: mode === "wipe" ? `inset(0 0 0 ${seam}%)` : undefined,
            opacity:
              mode === "blend" ? blend / 100 : mode === "blink" ? undefined : 1,
          }}
        >
          <Shot after={true} />
        </div>

        {mode === "wipe" && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-orange"
            style={{ left: `${seam}%` }}
          />
        )}

        {mode === "regions" &&
          REGIONS.map((r, n) => (
            <span
              key={r.box}
              aria-hidden="true"
              className={`absolute rounded-sm border transition-colors ${
                hot === n
                  ? "border-orange bg-orange/20"
                  : "border-orange/70 bg-orange/[0.07]"
              }`}
              style={r.style}
            />
          ))}

        {mode === "wipe" && (
          <span className="absolute top-2 left-2 rounded bg-deep/80 px-2 py-1 font-mono text-[10px] text-quiet">
            before
          </span>
        )}
        <span className="absolute top-2 right-2 rounded bg-deep/80 px-2 py-1 font-mono text-[10px] text-orange">
          {mode === "regions"
            ? `after · ${REGIONS.length} regions`
            : mode === "wipe"
              ? "after"
              : "before ⇄ after"}
        </span>
      </div>

      {mode === "blend" && (
        <input
          type="range"
          min={0}
          max={100}
          value={blend}
          onChange={(e) => setBlend(Number(e.target.value))}
          aria-label="blend"
          className="mx-auto mt-3 block w-full max-w-2xl accent-[#ff4a19]"
        />
      )}

      {/* the table under the picture: the boxes, and who owns each */}
      <table className="mt-4 w-full text-left">
        <thead>
          <tr className="font-mono text-[10px] tracking-[0.14em] text-quiet uppercase">
            <th className="pb-2 font-normal">region</th>
            <th className="pb-2 font-normal">component</th>
            <th className="hidden pb-2 text-right font-normal sm:table-cell">
              wrote it
            </th>
          </tr>
        </thead>
        <tbody>
          {REGIONS.map((r, n) => (
            <tr
              key={r.box}
              onPointerEnter={() => setHot(n)}
              onPointerLeave={() => setHot(null)}
              className={`border-t border-hairline transition-colors ${
                hot === n ? "bg-orange/[0.06]" : ""
              }`}
            >
              <td className="py-2 font-mono text-[11px] text-quiet">{r.box}</td>
              <td className="py-2 font-mono text-[11px] text-ivory">
                {r.owner}
              </td>
              <td className="hidden py-2 text-right font-mono text-[11px] break-all text-warm sm:table-cell">
                {r.at}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 border-t border-hairline pt-4">
        <p className="font-mono text-[11px] tracking-[0.16em] text-quiet uppercase">
          accept matching changes
        </p>
        <p className="mt-3 rounded-lg border border-hairline bg-deep px-3 py-2.5 font-mono text-[11px] leading-5 text-ivory">
          variance accept --shape v1:9f2a11c4e77b
          <span className="mt-1 block text-warm">
            accepts this change in 8 UI states · leaves 3 with additional
            changes for review
          </span>
        </p>
        <p className="mt-3 text-xs leading-5 text-quiet">
          Paths, commands, fingerprints, and ignore rules are printed as text you can select and paste. The
          report is one self-contained HTML file with no network dependency, so
          it opens directly from a CI artifact.
        </p>
      </div>
    </div>
  );
}
