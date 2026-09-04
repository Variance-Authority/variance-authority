import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalize, type Viewport } from '@variance-authority/core';
import { collect } from '@variance-authority/dom';
import { createSession } from './session.js';

/**
 * The cost argument, measured rather than asserted.
 *
 * Everything in this package is a trade: give up the guarantee that each subject
 * starts from a clean world, get back the time spent rebuilding that world
 * hundreds of times. The trade is only worth making if the numbers say so, and
 * only worth *keeping* if the numbers stay said — so they are a test, not a
 * paragraph in a README.
 *
 * What can gate the suite is narrower than what gets printed. A count is exact
 * and a share of a run's own clock is self-normalising — load inflates such a
 * ratio's numerator and denominator together — so both hold on a machine running
 * fifteen other test files. Dividing one separately-timed run by another does
 * not, and a bound on that division fails for reasons that have nothing to do
 * with the code under test, which is how a suite stops being trusted. The
 * wall-clock speedup is therefore reported on every run and gated by nothing;
 * the claim behind it is gated by things that do not move.
 *
 * One thing that moves it is the suite itself. `yarn test` instruments every
 * product module it loads, and the share below has `new JSDOM` on one side and
 * `collect` and `normalize` on the other — a library against the product, so
 * probes land in one half and not the other. Instrumented, the reading falls
 * from about two thirds to about half, which is the bound. So this file runs
 * under `yarn measure` and `vitest.measure.config.ts`, where nothing is
 * instrumented and the number describes the product rather than the product
 * plus the apparatus watching it.
 *
 * `new JSDOM()` per subject stands in for the family of per-subject setup costs:
 * a fresh test environment, a browser launch, a Storybook iframe reload. They
 * differ by orders of magnitude in absolute terms and behave identically in
 * shape — paid once per subject, and avoidable.
 *
 * Note this file runs in the `node` environment, not `jsdom`: it constructs its
 * own documents so it can time the construction.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

const SUBJECTS = 30;

/** A design system's worth of CSS, most of which matches nothing. */
const DESIGN_SYSTEM = Array.from(
  { length: 300 },
  (_, index) => `.ds-${index} { color: rgb(${index % 255} 0 0); padding: ${index % 24}px }`,
)
  .concat(['.card { padding: 8px }', '.card-body { color: #333 }'])
  .join('\n');

const MARKUP = '<div class="card"><p class="card-body">Hello</p></div>';

/** Worlds built and the time inside them, since process start. Read via `meter`. */
let builds = 0;
let buildMs = 0;

function documentWithStyles(): Document {
  const started = performance.now();

  const dom = new JSDOM(`<!doctype html><html><head><style>${DESIGN_SYSTEM}</style></head><body></body></html>`);
  const { document } = dom.window;

  // Force the CSSOM before the clock stops. Parsing the design system is the
  // expensive half of building a world and JSDOM defers it, so an untouched
  // sheet would bill the parse to whichever subject first asked for a computed
  // style — moving the cost out of the number that exists to hold it.
  const sheet = document.styleSheets[0];
  if (sheet === undefined || sheet.cssRules.length === 0) {
    throw new Error('the design system did not parse, so nothing here is measuring what it says');
  }

  builds += 1;
  buildMs += performance.now() - started;

  return document;
}

/** What a regime spent: wall-clock, worlds built, and how much of the clock went on building them. */
interface Cost {
  readonly ms: number;
  /** `new JSDOM` here; a browser launch or an iframe reload in a real runner. */
  readonly builds: number;
  /** Share of `ms` spent building worlds — the part a session pays once instead of per subject. */
  readonly buildShare: number;
}

/** Start a bill. Call the returned function to close it. */
function meter(): () => Cost {
  const fromBuilds = builds;
  const fromBuildMs = buildMs;
  const started = performance.now();

  return () => {
    const ms = performance.now() - started;
    return { ms, builds: builds - fromBuilds, buildShare: (buildMs - fromBuildMs) / ms };
  };
}

/** Rebuild the world for every subject: the regime a session replaces. */
function cold(subjects: number): Cost {
  const stop = meter();

  for (let index = 0; index < subjects; index += 1) {
    const document = documentWithStyles();
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = MARKUP;

    normalize(
      collect(container as unknown as Element, {
        subject: { id: `story:s${index}`, kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@bench',
        fonts: [],
      }),
    );
  }

  return stop();
}

/** One world, every subject, probes included. */
function warm(subjects: number): Cost & { readonly probeShare: number } {
  const stop = meter();

  const document = documentWithStyles();
  const session = createSession({ document, viewport: VIEWPORT, engine: 'jsdom@bench', fonts: [] });

  for (let index = 0; index < subjects; index += 1) {
    session.run({ id: `story:s${index}`, kind: 'story' }, (container) => {
      container.innerHTML = MARKUP;
    });
  }

  const stats = session.stats();
  session.dispose();

  return { ...stop(), probeShare: stats.probeShare };
}

describe('the cost of not rinsing', () => {
  it('builds one world for any number of subjects, and the world is most of the cost', () => {
    // Warm once so neither side pays for lazy module initialisation.
    cold(2);
    warm(2);

    const rebuilt = cold(SUBJECTS);
    const session = warm(SUBJECTS);
    const longer = warm(SUBJECTS * 4);

    console.log(
      [
        '',
        `SESSION COST (${SUBJECTS} subjects, ${DESIGN_SYSTEM.split('\n').length} CSS rules)`,
        `  rebuild per subject: ${rebuilt.ms.toFixed(0)}ms  (${(rebuilt.ms / SUBJECTS).toFixed(1)}ms each)`,
        `  one session:         ${session.ms.toFixed(0)}ms  (${(session.ms / SUBJECTS).toFixed(1)}ms each)`,
        `  worlds built:        ${rebuilt.builds} rebuilding, ${session.builds} in a session`,
        `  spent building them: ${(rebuilt.buildShare * 100).toFixed(0)}% of the rebuild regime`,
        `  speedup:             ${(rebuilt.ms / session.ms).toFixed(1)}×  (reported, not gated — see the todo below)`,
        `  probe overhead:      ${(session.probeShare * 100).toFixed(1)}% of session time`,
        '',
      ].join('\n'),
    );

    // Half one: the saving, counted. A session builds one world however many
    // subjects run through it; the regime it replaces builds one apiece. These
    // are integers, so a busy machine cannot move them — and the third reading
    // is what catches a rebuild reintroduced on a threshold rather than per
    // subject, which the fixed-size comparison above would not see.
    expect(rebuilt.builds).toBe(SUBJECTS);
    expect(session.builds).toBe(1);
    expect(longer.builds).toBe(1);

    // Half two: the saving is worth having only if a world costs something.
    // This is a share of one run's own clock, so load moves the numerator and
    // the denominator together and it survives a parallel suite. With the
    // counts above it yields the speedup by arithmetic rather than by
    // stopwatch — removing a fraction f of the work is a 1/(1 - f) speedup, so
    // half the regime being setup is "at least twice", derived from measured
    // parts. The bound sits where the trade would stop being obviously worth
    // making, not where the current reading happens to land (~68%).
    expect(rebuilt.buildShare).toBeGreaterThan(0.5);
  });

  // The end-to-end speedup, which is the sentence a reader actually wants, and
  // which nothing here asserts. It divides one separately-timed run by another,
  // and the session run is the small denominator: a single GC pause or
  // scheduling stall lands whole in ~90ms of warm time and barely dents ~290ms
  // of cold. Alone the ratio reads 3.2×; under a parallel `yarn test` on a
  // loaded box it reads ~1.1×, so a bound anywhere between them reddens the
  // suite over machine weather. The two halves above are the same claim in a
  // form the weather cannot reach.
  it.todo(
    'one session finishes a fixed corpus more than 1.5× faster than rebuilding the world per subject — needs a lane where the measurement has the machine to itself, since the ratio divides two separately-timed runs and load alone moves it from 3.2× to ~1.1×',
  );

  it('keeps the safety net cheaper than the thing it replaces', () => {
    // The probe is the entire price of detection. If it ever rivalled the setup
    // cost it displaces, the honest move would be to go back to rinsing.
    // Memoising sheet fingerprints on source text took this from 32% to ~2%.
    // The bound is set where a regression to per-probe rule serialization would
    // trip it, not where the current number happens to sit.
    const { probeShare } = warm(SUBJECTS);
    expect(probeShare).toBeLessThan(0.15);
  });

  it('does not grow per-subject cost as the session lengthens', () => {
    // The failure this guards against: probe cost proportional to accumulated
    // state. If each subject had to fingerprint everything every previous subject
    // left behind, a long session would degrade quadratically and the saving
    // would evaporate exactly where it matters most.
    const short = warm(10).ms / 10;
    const long = warm(60).ms / 60;

    expect(long).toBeLessThan(short * 2.5);
  });
});
