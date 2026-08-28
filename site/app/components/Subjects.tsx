/**
 * The range, ordered by distance from a screenshot. What each reading needs
 * thins out from the top down — a baseline, then a build, then a record, then
 * nothing — and the last row never opens a browser at all. Ordering by that
 * cost is the argument: the tools are one drill applied to different material,
 * not a product line stapled together.
 */
const SUBJECTS = [
  {
    what: "Two variants of one page",
    needs: "a baseline each",
    body: "The difference between them has a history of its own, so a change to what the flag actually does is a result rather than something you notice by eye.",
  },
  {
    what: "The suite against itself",
    needs: "one build",
    body: "Many states at a single commit, joined on the components they share: which of them are watching the same rendering, and which disagree right now, with no baseline involved anywhere.",
  },
  {
    what: "One state across many runs",
    needs: "a record",
    body: "How often a component has caused an approved change, how long since a flake was last seen, and how far a token has drifted across steps no single review ever saw the total of.",
  },
  {
    what: "One live page",
    needs: "nothing to approve",
    body: "Spacing, alignment, prominence, repetition, and an independent accessibility reading of a single interface—evidence to work from, with no verdict attached to it.",
  },
  {
    what: "One story, run twice",
    needs: "two executions",
    body: "Arrange, Act, Assert kept as a state machine, so two runs can be asked whether they began differently and at which act their behaviour stopped agreeing.",
  },
  {
    what: "What a package publishes",
    needs: "no browser",
    body: "Every entrypoint a manifest opens and every name behind it. Moving a re-export changes an import that lint and typechecking still accept; here it is a named change before a consumer's build finds it.",
  },
] as const;

/** What else can be read the way a screenshot is read. */
export default function Subjects() {
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-panel">
      <p className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-3 font-mono text-[11px] tracking-[0.16em] text-warm uppercase">
        <span>what is read</span>
        <span>what it needs</span>
      </p>
      <ul>
        {SUBJECTS.map((s, i) => (
          <li
            key={s.what}
            className="group flex gap-4 border-b border-hairline px-5 py-4 transition-colors last:border-b-0 hover:bg-charcoal"
          >
            <span className="mt-0.5 font-mono text-[11px] text-warm">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="basis-full text-sm font-medium text-ivory transition-colors group-hover:text-orange sm:basis-auto">
                  {s.what}
                </span>
                <span className="font-mono text-[11px] text-warm">
                  {s.needs}
                </span>
              </p>
              <p className="mt-1.5 text-xs leading-5 text-quiet">{s.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
