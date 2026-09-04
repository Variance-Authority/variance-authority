/** The two second passes. Each varies one input and holds the other. */
const PASSES = [
  {
    name: "again",
    world: "held",
    time: "advanced",
    asks: "Does this state drift on its own?",
    answer: "unstable",
  },
  {
    name: "alone",
    world: "rebuilt",
    time: "held",
    asks: "Did another state change this one?",
    answer: "order-dependent",
  },
] as const;

/** One question asked at four prices, cheapest first. */
const LADDER = [
  {
    reading: "pendingSuspense",
    settles: "whether the state has arrived at all",
    cost: "a fiber traversal",
  },
  {
    reading: "awaitQuiet",
    settles: "whether the application has stopped rendering",
    cost: "a commit hook, installed before React",
  },
  {
    reading: "documentDigest",
    settles: "whether anything that can reach a renderer changed",
    cost: "a read of a page already mounted",
  },
  {
    reading: "the image",
    settles: "whether the pixels changed",
    cost: "a raster, roughly eighteen times a reading",
  },
] as const;

/** What a row moving under a row that held actually means. */
const CONVERSE = [
  {
    when: "the fiber changed, the document did not",
    means: "Components re-rendered and the page did not follow. That is the receipt a refactor never gets.",
  },
  {
    when: "the document changed, the image did not",
    means: "Something reached the browser and the picture came back the same: sub-pixel geometry, a repeated colour, a rule that lost the cascade.",
  },
  {
    when: "nothing that was read changed, the image did",
    means: "Every input the run looked at agreed and the picture changed anyway. This is the one place the report says flake.",
  },
] as const;

/** How a flake is separated from a change, and what that costs. */
export default function Flakes() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
          <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
            speed, not isolation
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
            The world is not rebuilt between states.
          </h3>
          <p className="mt-3 text-sm leading-6 text-quiet">
            The usual defence against one test polluting another is to tear the
            world down and build it again — on every state, forever, as
            insurance against a leak most suites do not have. A session keeps
            one standing DOM and photographs shared state around each mount
            instead. Measured at three to four times faster than rinsing, with
            the probe costing about 2% of a session.
          </p>
          <p className="mt-3 text-sm leading-6 text-quiet">
            The renderer keeps one page per viewport and reuses that too, so one
            browser serves 1x and 2x, or a phone width and a desktop one.
          </p>
          <p className="mt-3 text-sm leading-6 text-ivory">
            When a leak is real, it arrives with the name of whatever wrote it.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-xl border border-hairline bg-deep p-4 font-mono text-[11px] leading-5 text-quiet">
            <code>
              <span className="text-orange">[confirmed]</span> story:card{"\n"}
              {"  "}cause: story:toolbar (rendered by Button, Toolbar){"\n"}
              {"  "}via:{"   "}sheet:&lt;style:0&gt;{"\n"}
              {"  "}fix:{"   "}scope it so it cannot reach story:card
            </code>
          </pre>
        </div>

        <div className="flex flex-col rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
          <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
            two second passes
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
            One variable each. Neither is a retry.
          </h3>
          <ul className="mt-5 space-y-3">
            {PASSES.map((pass) => (
              <li
                key={pass.name}
                className="rounded-xl border border-hairline bg-deep p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-mono text-sm text-ivory">
                    {pass.name}
                  </span>
                  <span className="font-mono text-[10px] text-warm">
                    world {pass.world} · time {pass.time}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-quiet">{pass.asks}</p>
                <p className="mt-2 font-mono text-[10px] text-orange">
                  {pass.answer}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm leading-6 text-quiet">
            The order carries the argument.{" "}
            <span className="font-mono text-[0.95em] text-ivory">again</span>{" "}
            asks first, because{" "}
            <span className="font-mono text-[0.95em] text-ivory">alone</span>{" "}
            infers that the world changed a state — which is only evidence if two
            readings of one world would have agreed. Asked the other way round,
            a page with a clock in it produces a confident sentence about suite
            pollution and sends somebody to bisect a run order that has nothing
            to do with it.
          </p>
          <p className="mt-3 text-sm leading-6 text-quiet">
            Both outcomes of both passes are reported and neither clears
            anything.{" "}
            <span className="font-mono text-[0.95em] text-ivory">
              variance accept
            </span>{" "}
            refuses either: promoting a reading chosen by a race makes the coin
            flip the thing every later run is measured against.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-hairline pb-5">
          <div>
            <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
              one question, four prices
            </p>
            <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
              Has this state stopped drifting?
            </h3>
          </div>
          <p className="max-w-md text-sm leading-6 text-quiet">
            A component tree that did not re-render cannot have produced a
            different document, and a document that did not change cannot paint a
            different image. The cheapest reading that answers ends the
            question.
          </p>
        </div>

        <ol className="mt-5 grid gap-2">
          {LADDER.map((rung, index) => (
            <li
              key={rung.reading}
              className={`grid gap-x-6 gap-y-1 rounded-xl border p-4 sm:grid-cols-[13rem_1fr_auto] sm:items-baseline ${
                index === LADDER.length - 1
                  ? "border-orange/50 bg-orange/[0.05]"
                  : "border-hairline bg-deep"
              }`}
            >
              <span className="font-mono text-sm text-ivory">
                {rung.reading}
              </span>
              <span className="text-sm leading-6 text-quiet">
                {rung.settles}
              </span>
              <span className="font-mono text-[10px] text-warm sm:text-right">
                {rung.cost}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-5 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
          A document byte-identical to the one its baseline was painted from is
          never photographed again. On a suite where nothing changed, that is the
          whole run.
        </p>

        <div className="mt-8 grid gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-3">
          {CONVERSE.map((row) => (
            <div key={row.when} className="bg-deep p-5">
              <p className="font-mono text-[10px] tracking-widest text-orange uppercase">
                {row.when}
              </p>
              <p className="mt-3 text-sm leading-6 text-quiet">{row.means}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-6 text-quiet">
          A row that changes while the row above it held is not a wasted check. It
          is the finding, and climbing until two samples agree is what throws it
          away.
        </p>
      </div>
    </div>
  );
}
