const GOOD_FIT = [
  "Your UI already runs in Playwright, Storybook, served routes, or jsdom.",
  "You want a changed region to resolve to a component and a file:line, not just to the DOM node that painted it.",
  "You want CI, storage, and renderer placement to remain under your control.",
] as const;

const CHOOSE_MANAGED = [
  "You do not want to own a renderer image, a storage bucket, an upload path, and the on-call rotation behind them.",
  "Designers and PMs need a review link, with branch handling and reviewer state managed for them.",
  "You need a vendor-operated browser and device grid, a contractual data-residency guarantee, and paid support.",
] as const;

/** The operating trade, stated where it changes an adoption decision. */
export default function OperatingBargain() {
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <div className="rounded-2xl border border-orange/50 bg-orange/[0.05] p-6 sm:p-7">
        <p className="font-mono text-[10px] tracking-[0.16em] text-orange uppercase">
          a good fit
        </p>
        <ul className="mt-5 space-y-4">
          {GOOD_FIT.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-6 text-ivory">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-orange" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
        <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
          choose a managed product when
        </p>
        <p className="mt-3 text-sm leading-6 text-quiet">
          Percy, Chromatic, Argos, and Applitools are good products. Each is
          more polished than this project on everything a team hits in its first
          week.
        </p>
        <ul className="mt-5 space-y-4">
          {CHOOSE_MANAGED.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-6 text-quiet">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-warm" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-hairline bg-deep/60 p-5 lg:col-span-2">
        <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline pb-4 font-mono text-xs text-quiet">
          <span className="text-green">open source</span>
          <span className="text-hairline">/</span>
          <span>MIT</span>
          <span className="text-hairline">/</span>
          <span>runs in your infrastructure</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] text-orange uppercase">
              repeatability
            </p>
            <p className="mt-2 text-sm leading-6 text-quiet">
              A changed state is read again in the same world and then rendered
              with the world rebuilt around it, for up to twenty states, with
              nothing to configure. Both answers go in the report and neither
              can be accepted.{" "}
              <a
                href="/#flakes"
                className="text-orange transition-colors hover:text-ivory"
              >
                Separating a flake from a change &rarr;
              </a>
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-orange uppercase">cost</p>
            <p className="mt-2 text-sm leading-6 text-quiet">
              There is no vendor meter. The last column of the table below is
              what you pay instead.
            </p>
          </div>
        </div>
        <a
          href="/reference/comparison"
          className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
        >
          Compare the operating models →
        </a>
      </div>
    </div>
  );
}
