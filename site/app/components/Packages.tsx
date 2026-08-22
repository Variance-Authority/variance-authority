import SectionHead from "./SectionHead";

/**
 * How far the last card must stretch to finish its row. A grid of n over c
 * columns leaves `n % c` cards on the final row; widening the last one by the
 * shortfall closes it, so a group never shows bordered gaps where a reader
 * would look for packages that are not there.
 */
function fill(n: number, cols: number): number {
  const rest = n % cols;
  return rest === 0 ? 1 : cols - rest + 1;
}

/** Roles are the `holds` column of docs/architecture.md, kept verbatim. */
const PACKAGES: { group: string; items: { name: string; role: string }[] }[] = [
  {
    group: "what you install",
    items: [
      {
        name: "cli",
        role: "the workflow, which is the one place a workflow belongs",
      },
      {
        name: "playwright-test",
        role: "additive observation and assertion helpers for a suite you already have",
      },
      {
        name: "storybook-collector",
        role: "the browser half: each story opened, made ready, and collected",
      },
      {
        name: "route-collector",
        role: "pages an application already serves, opened and collected",
      },
      {
        name: "unit-test",
        role: "resource-closed capture archives, for a later render process",
      },
      { name: "observe", role: "one composition, shipped as an example" },
      { name: "mcp", role: "the observation, exposed to an agent" },
    ],
  },
  {
    group: "what they are built on",
    items: [
      {
        name: "core",
        role: "the format, the rules, comparison, attribution, verdicts, plans",
      },
      { name: "sense", role: "the source read rather than run" },
      { name: "dom", role: "extraction, and CSS applicability pruning" },
      { name: "react", role: "fibers → owner chains, props digests, portals" },
      {
        name: "jsx-source",
        role: "the file and line that wrote an element, carried as far as the DOM node",
      },
      {
        name: "raster",
        role: "the pixel tier as data — contracts, policies, the gate",
      },
      { name: "png", role: "decoding, comparison, the diff image" },
      { name: "session", role: "many subjects in one standing world" },
      { name: "playwright", role: "the persistent harness, and a renderer" },
      { name: "store", role: "baselines on disk, and in git-LFS" },
      {
        name: "report",
        role: "what a run leaves behind, so several readers share one shape",
      },
      {
        name: "history",
        role: "what a row may contain, and what the numbers mean",
      },
      {
        name: "package",
        role: "what a package offers an adopter: every entrypoint a manifest opens",
      },
    ],
  },
  {
    group: "what an operator deploys",
    items: [
      { name: "server", role: "the history service the operator runs" },
      {
        name: "remote",
        role: "a renderer and a store on the other side of a hop",
      },
    ],
  },
];

/** The kinds on offer, grouped by what a reader does with them. */
export default function Packages() {
  return (
    <section
      id="packages"
      className="scroll-mt-24 border-t border-hairline py-20"
    >
      <SectionHead
        n="07"
        label="packages"
        title="There is no pipeline. There are tools."
      >
        A fixed sequence encodes one team&rsquo;s workflow and fails the next.
        What ships instead is a set of kinds — acquire, prepare, render, hash,
        compare, isolate, map, judge, record — and a pipeline is something you
        assemble from them. Two of those kinds need a host: a DOM to acquire
        from, a browser to render in. Three need nothing at all, and that
        distribution is the whole economic argument.
      </SectionHead>
      <div className="mt-12 space-y-8">
        {PACKAGES.map((g) => {
          const n = g.items.length;
          const lgCols = n < 3 ? n : 3;
          const SM = ["", "", "sm:col-span-2"][fill(n, 2)];
          const LG = ["", "", "lg:col-span-2", "lg:col-span-3"][fill(n, lgCols)];
          return (
            <div key={g.group}>
              <p className="mb-3 flex items-center gap-3 font-mono text-[11px] tracking-[0.16em] text-warm uppercase">
                {g.group}
                <span className="h-px flex-1 bg-hairline" />
                <span className="text-quiet">{n}</span>
              </p>
              {/* Cells carry their own hairlines so a short last row stays panel-coloured. */}
              <div
                className={`grid overflow-hidden rounded-2xl border border-hairline bg-panel sm:grid-cols-2 [&>*]:min-w-0 ${
                  n < 3 ? "lg:grid-cols-2" : "lg:grid-cols-3"
                }`}
              >
                {g.items.map((p, idx) => (
                  <div
                    key={p.name}
                    className={`group border-b border-r border-hairline p-5 transition-colors hover:bg-charcoal ${
                      idx === n - 1 ? `${SM} ${LG}` : ""
                    }`}
                  >
                    <p className="font-mono text-[13px] text-ivory transition-colors group-hover:text-orange">
                      <span className="text-quiet">@variance-authority/</span>
                      {p.name}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-quiet">{p.role}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 max-w-2xl font-mono text-xs leading-5 text-warm">
        <span className="text-orange">{"//"}</span> a consumer knows one package:
        adopter-facing code names its immediate neighbour, never its
        neighbour&rsquo;s collaborators
      </p>
    </section>
  );
}
