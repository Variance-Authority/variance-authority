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

function documentWithStyles(): Document {
  const dom = new JSDOM(`<!doctype html><html><head><style>${DESIGN_SYSTEM}</style></head><body></body></html>`);
  return dom.window.document;
}

/** Rebuild the world for every subject: the regime a session replaces. */
function cold(subjects: number): number {
  const started = performance.now();

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

  return performance.now() - started;
}

/** One world, every subject, probes included. */
function warm(subjects: number): { ms: number; probeShare: number } {
  const started = performance.now();

  const document = documentWithStyles();
  const session = createSession({ document, viewport: VIEWPORT, engine: 'jsdom@bench', fonts: [] });

  for (let index = 0; index < subjects; index += 1) {
    session.run({ id: `story:s${index}`, kind: 'story' }, (container) => {
      container.innerHTML = MARKUP;
    });
  }

  const stats = session.stats();
  session.dispose();

  return { ms: performance.now() - started, probeShare: stats.probeShare };
}

describe('the cost of not rinsing', () => {
  it('is faster than rebuilding the world per subject', () => {
    // Warm once so neither side pays for lazy module initialisation.
    cold(2);
    warm(2);

    const coldMs = cold(SUBJECTS);
    const warmResult = warm(SUBJECTS);
    const ratio = coldMs / warmResult.ms;

    console.log(
      [
        '',
        `SESSION COST (${SUBJECTS} subjects, ${DESIGN_SYSTEM.split('\n').length} CSS rules)`,
        `  rebuild per subject: ${coldMs.toFixed(0)}ms  (${(coldMs / SUBJECTS).toFixed(1)}ms each)`,
        `  one session:         ${warmResult.ms.toFixed(0)}ms  (${(warmResult.ms / SUBJECTS).toFixed(1)}ms each)`,
        `  speedup:             ${ratio.toFixed(1)}×`,
        `  probe overhead:      ${(warmResult.probeShare * 100).toFixed(1)}% of session time`,
        '',
      ].join('\n'),
    );

    // Deliberately loose. The claim under test is "materially cheaper", not a
    // specific multiple — a tight bound here would fail on a loaded CI box and
    // teach everyone to ignore it.
    expect(ratio).toBeGreaterThan(1.5);
  });

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
