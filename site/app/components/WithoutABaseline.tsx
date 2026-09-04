/** What each instrument reads, and the thing it can say that a diff cannot. */
const CLOSING = [
  {
    fact: "no approved image",
    means: "Nothing here waits on a baseline to exist, or on somebody to have looked at one.",
  },
  {
    fact: "no verdict, no exit code",
    means: "None of it passes or fails a run. It is evidence, and it is read by whoever is asking.",
  },
  {
    fact: "one run is enough",
    means: "The contradiction is inside a single execution. There is no second commit to compare against.",
  },
] as const;

/** Eyes, Vantage, journeys and divergence: four readings of the run in front of you. */
export default function WithoutABaseline() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <article className="flex flex-col rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
          <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
            eyes
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
            Which elements did this test actually address?
          </h3>
          <p className="mt-3 text-sm leading-6 text-quiet">
            Every query the test issued, in order, with what it resolved
            to&mdash;and the React tree behind that element: the components
            enclosing it innermost first, each with the digest of its own props,
            and the component whose JSX put it there.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-xl border border-hairline bg-deep p-4 font-mono text-[11px] leading-5 text-quiet">
            <code>
              <span className="text-warm">assert</span>{" "}
              getByRole(&apos;button&apos;, {"{"} name: &apos;Remove&apos; {"}"}
              ){"\n"}
              {"  "}
              <span className="text-orange">resolved</span> &lt;button
              name=&quot;Remove&quot;&gt;{"\n"}
              {"  "}owners{"    "}RemoveButton &larr; CartRow &larr; CartCard
              {"\n"}
              {"  "}createdBy CartRow{"   "}&mdash; who decided one belongs here
            </code>
          </pre>
          <p className="mt-5 text-sm leading-6 text-quiet">
            Those last two lines are different answers to{" "}
            <em>who is responsible</em>, and the report keeps them apart. When a
            list reorders, naming the element that moved reports the thing that
            was rearranged;{" "}
            <span className="font-mono text-[0.95em] text-ivory">
              createdBy
            </span>{" "}
            names the code that rearranged it.
          </p>
          <p className="mt-3 text-sm leading-6 text-quiet">
            Under Playwright it also holds the commits: which render bodies ran,
            and separately which live component instance scheduled the update
            &mdash; so a re-render during your assert phase can be reported as
            having come from a component the test never addressed. Where no
            fiber is reachable it says which of the two reasons applies instead
            of guessing.
          </p>
          <a
            href="/docs/eyes"
            className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
          >
            test attention &rarr;
          </a>
        </article>

        <article className="flex flex-col rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
          <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
            vantage
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
            What is this run saying, while it is still saying it?
          </h3>
          <p className="mt-3 text-sm leading-6 text-quiet">
            A test that hangs reports what it <em>wanted</em>&mdash;thirty
            seconds later, from a process that has already torn the page down.
            The other half is what the execution heard, and from whom, and it is
            readable while the test is still hanging.
          </p>
          <ul className="mt-5 grid gap-2">
            {[
              ["nothing at all", "a wiring fact: nothing is announcing"],
              [
                "the page spoke, the service did not",
                "a request that never arrived, or never came back",
              ],
              [
                "three announcements, then one vaStart still open",
                "the call that is hanging, by name",
              ],
            ].map(([shows, means]) => (
              <li
                key={shows}
                className="rounded-xl border border-hairline bg-deep p-4"
              >
                <p className="font-mono text-[11px] leading-5 text-ivory">
                  {shows}
                </p>
                <p className="mt-1 text-xs leading-5 text-quiet">{means}</p>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm leading-6 text-quiet">
            The log of announcements is bounded and says how many it dropped.
            The tally of work that opened and never closed is not bounded and is
            never approximated&mdash;that is the one an unfinished run is
            actually asked about.
          </p>
          <p className="mt-3 text-sm leading-6 text-quiet">
            Nothing is written to disk, and every sentence is
            fire-and-forget&mdash;a run that failed because the thing watching
            it went away would be worse than no watcher at all.
          </p>
          <a
            href="/docs/vantage"
            className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
          >
            watch a run that has not finished &rarr;
          </a>
        </article>

        <article className="flex flex-col rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
          <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
            scenarios
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
            At which Act did two executions stop agreeing?
          </h3>
          <p className="mt-3 text-sm leading-6 text-quiet">
            A journey is a named sequence of states and the Acts between them.
            Two executions are compared edge by edge, and each edge carries a
            digest derived from the semantic deltas it produced&mdash;so an
            unrelated edit that moves both sides of an edge together leaves it
            alone.
          </p>
          <ul className="mt-5 grid gap-2">
            {[
              ["variation", "the Act moved state and the page followed"],
              [
                "absorbed",
                "an input moved and the page did not. It landed on nothing",
              ],
              [
                "reshaped",
                "a different component tree from the same inputs: a boundary resolved",
              ],
            ].map(([slice, was]) => (
              <li
                key={slice}
                className="grid gap-x-4 gap-y-1 rounded-xl border border-hairline bg-deep p-4 sm:grid-cols-[7rem_1fr] sm:items-baseline"
              >
                <span className="font-mono text-sm text-ivory">{slice}</span>
                <span className="text-xs leading-5 text-quiet">{was}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm leading-6 text-quiet">
            Alignment stops at the first Act that was inserted, missing or
            repeated, and prints the values that did not match. It never shifts
            the later ordinals to make the rest agree, which is the move that
            turns one inserted step into <em>everything after this changed</em>.
          </p>
          <a
            href="/docs/scenarios"
            className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
          >
            compare runtime journeys &rarr;
          </a>
        </article>

        <article className="flex flex-col rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
          <p className="font-mono text-[10px] tracking-[0.16em] text-warm uppercase">
            divergence
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-ivory">
            One set of inputs. More than one result. At one commit.
          </h3>
          <p className="mt-3 text-sm leading-6 text-quiet">
            The same component, the same props digest, and two renderings in the
            same run. That is not a regression&mdash;it says the
            component&apos;s own inputs do not determine its output, which is
            either a fact about the design or a reading that will not repeat.
            Each rendering after the first is lifted out of the page it was
            found in and read against the first, so the answer names an input:
          </p>
          <pre className="mt-5 overflow-x-auto rounded-xl border border-hairline bg-deep p-4 font-mono text-[11px] leading-5 text-quiet">
            <code>
              <span className="text-orange">Price (token)</span> &mdash; 2
              rendering(s) from one props digest{"\n"}
              {"  "}2 subject(s): price, receipt{"\n"}
              {"  "}1 subject(s): promo{"\n"}
              {"    "}variation &mdash; an input moved and the page followed
              {"\n"}
              {"    "}Price inherited a different `color` &mdash; an ancestor
              declared it
            </code>
          </pre>
          <p className="mt-5 text-sm leading-6 text-quiet">
            The same question is asked one layer down of source. Where a run
            recorded execution, one module read by several observers has regions
            some of them entered and others never did&mdash;a function body, a
            branch, a handler, a resume point. Same file, same imports, same
            props, a different path through them, and nothing static says it.
          </p>
          <a
            href="/docs/composition"
            className="mt-5 inline-block font-mono text-xs text-orange transition-colors hover:text-ivory"
          >
            one input, two renderings &rarr;
          </a>
        </article>
      </div>

      <div className="rounded-2xl border border-hairline bg-panel p-6 sm:p-7">
        <h3 className="text-xl font-bold tracking-tight text-ivory">
          None of the four opens a baseline.
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-quiet">
          Approval answers <em>is this different from what we agreed?</em> These
          answer <em>what happened here?</em>&mdash;which is the question in
          front of anyone whose suite is failing, and the one an approved image
          has never been able to reach.
        </p>
        <div className="mt-6 grid gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-3">
          {CLOSING.map((row) => (
            <div key={row.fact} className="bg-deep p-5">
              <p className="font-mono text-[10px] tracking-widest text-orange uppercase">
                {row.fact}
              </p>
              <p className="mt-3 text-sm leading-6 text-quiet">{row.means}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 border-l-2 border-orange pl-4 text-sm leading-6 text-ivory">
          Adopt any one of them on its own. Eyes installs beside the React
          Testing Library or Playwright already in the suite; Vantage is one
          environment variable; a journey is a test you already wrote, named.
        </p>
      </div>
    </div>
  );
}
