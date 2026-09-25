import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import type { RawCapture, RawNode, Viewport } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { collect, conditionsFor } from './collect.js';
import { indexStyleSheets } from './css.js';
import { STABILIZE_ATTRIBUTE } from './stabilize.js';

/**
 * Reusing one style index across the subjects that share a document.
 *
 * Indexing is the expensive half of a collection: it walks every rule in every
 * sheet on the page, while matching only walks the handful of buckets a subject's
 * own elements key into. A session runs hundreds of subjects against one document
 * and one set of sheets, so rebuilding the index per subject is the same work
 * repeated until it dominates — which is what the cost measurement below prints.
 *
 * The saving is only worth taking if it cannot change an answer, and there are
 * exactly two ways it could:
 *
 * - The sheets changed since the index was built. The collector cannot know this
 *   — it is handed an index, not a promise — so reuse is opt-in and invalidation
 *   belongs to whoever holds the index. The first test pins that this is real
 *   rather than advisory: a reused index genuinely does not see a later edit.
 * - The index was built for different conditions. That one *is* detectable here,
 *   and it is refused, because a capture keyed to 1280px whose `@media` blocks
 *   were flattened against 480px is a confident wrong answer sharing a baseline
 *   with the right one.
 *
 * This file runs in the `node` environment and builds its own documents, so it
 * can time their construction and mutate their sheets without a shared global.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

const OPTIONS = {
  subject: { id: 'story:card--default', kind: 'fixture' as const },
  viewport: VIEWPORT,
  engine: 'jsdom@test',
  fonts: ['Inter/400/normal/deadbeef'],
};

function world(css: string): { document: Document; container: Element } {
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${css}</style></head>` +
      `<body><div id="canvas"></div></body></html>`,
  );
  const document = dom.window.document as unknown as Document;
  return { document, container: document.getElementById('canvas')! };
}

/** The value the cascade was *told*, read straight off the capture. */
function declaredColor(capture: RawCapture): string | undefined {
  const subject = capture.root.children[0] as RawNode | undefined;
  for (const rule of subject?.matchedRules ?? []) {
    for (const declaration of rule.declarations) {
      if (declaration.property === 'color') return declaration.value;
    }
  }
  return undefined;
}

describe('reusing a style index', () => {
  it('collects against the index it was given instead of rebuilding one per subject', () => {
    // Guards against the option being accepted and quietly ignored, which would
    // look like a working optimization and deliver nothing. The only observable
    // difference between a reused index and a rebuilt one is that the reused one
    // predates a later edit to the sheet — so that is what is asserted, and it is
    // also precisely why the holder of an index must invalidate it on the probe's
    // sheet fingerprints rather than on a count or a timestamp.
    const { document, container } = world('.card { color: rgb(1, 2, 3) }');
    const index = indexStyleSheets(document, conditionsFor(document, VIEWPORT));

    document.querySelector('style')!.textContent = '.card { color: rgb(9, 9, 9) }';
    container.innerHTML = '<p class="card">x</p>';

    expect(declaredColor(collect(container, { ...OPTIONS, index }))).toBe('rgb(1, 2, 3)');
    expect(declaredColor(collect(container, OPTIONS))).toBe('rgb(9, 9, 9)');
  });

  it('refuses an index built for a different viewport rather than answering for the wrong one', () => {
    // The silent-wrong-answer version of this optimization. `@media (min-width:
    // 800px)` flattened against 480px drops the rule; the capture then reports a
    // 1280px environment whose declarations are the narrow layout's. Nothing in
    // the snapshot would look wrong, and it would share a baseline with the
    // correct capture — a content-addressing failure, so the artifact is refused
    // rather than produced.
    const { document, container } = world(
      '@media (min-width: 800px) { .card { color: rgb(9, 9, 9) } }',
    );
    const narrow = indexStyleSheets(document, conditionsFor(document, { ...VIEWPORT, width: 480 }));

    container.innerHTML = '<p class="card">x</p>';

    expect(() => collect(container, { ...OPTIONS, index: narrow })).toThrow(
      /different condition environment/,
    );
  });

  it('produces the same snapshot from a reused index as from a fresh one', () => {
    // The optimization's whole licence: identical inputs, identical hash. A fence
    // rather than a probe of the bug — if reuse ever diverged from a fresh build,
    // every session-collected baseline would disagree with every directly
    // collected one and neither side would say why.
    const { document, container } = world(
      '.card { color: rgb(1, 2, 3) } @media (min-width: 800px) { .card { padding: 4px } }',
    );
    container.innerHTML = '<p class="card">x</p>';

    const index = indexStyleSheets(document, conditionsFor(document, VIEWPORT));

    expect(normalize(collect(container, { ...OPTIONS, index })).renderHash).toBe(
      normalize(collect(container, OPTIONS)).renderHash,
    );
  });
});

/**
 * A page's worth of CSS: a component library, a wall of utilities, dead rules
 * from an older design system, and conditional groups that must be evaluated
 * before anything can be pruned. Roughly 600 rules, of which a dozen match.
 */
const DESIGN_SYSTEM = [
  ':root { --brand: #1ea7fd; --space: 4px }',
  '*, *::before, *::after { box-sizing: border-box }',
  'html, body { margin: 0; font-family: Inter, sans-serif }',
  '.card { border: 1px solid #e6e6e6; border-radius: 8px }',
  '.card-header { display: flex; justify-content: space-between }',
  '.card-title { font-size: 16px; font-weight: 600 }',
  '.card-body { padding: 12px }',
  '.card-footer { display: flex; gap: 8px }',
  '.btn { padding: 6px 12px; border-radius: 4px }',
  '.btn-primary { background: var(--brand); color: #fff }',
  '.badge { font-size: 11px; text-transform: uppercase }',
  '.list { margin: 0; padding-left: 16px }',
  '.list-item { line-height: 1.5 }',
  ...Array.from({ length: 200 }, (_, i) => `.u-m-${i} { margin: ${i}px }`),
  ...Array.from({ length: 200 }, (_, i) => `.legacy-${i} .legacy-inner { color: rgb(${i % 255} 0 0) }`),
  ...Array.from(
    { length: 100 },
    (_, i) => `@media (min-width: ${400 + i}px) { .resp-${i} { width: ${i}% } }`,
  ),
  ...Array.from(
    { length: 100 },
    (_, i) =>
      `@supports (display: grid) { .grid-${i} { grid-template-columns: repeat(${(i % 12) + 1}, 1fr) } }`,
  ),
].join('\n');

const MARKUP =
  '<article class="card">' +
  '<header class="card-header"><h3 class="card-title">Title</h3><span class="badge">New</span></header>' +
  '<div class="card-body"><p>Body copy</p><ul class="list"><li class="list-item">a</li><li class="list-item">b</li></ul></div>' +
  '<footer class="card-footer"><button class="btn btn-primary">Save</button><button class="btn">Cancel</button></footer>' +
  '</article>';

const SUBJECTS = 40;

/** What a regime spent: wall clock, and how many times it walked the document's sheets. */
interface Regime {
  readonly ms: number;
  /** Indexes built. Exact, so a busy machine cannot move it. */
  readonly walks: number;
}

/**
 * The design-system world, with a counter on `document.styleSheets`.
 *
 * `indexStyleSheets` reads it once per index it builds and nothing else in a
 * collection reads it at all — jsdom's own cascade reaches the sheets through
 * its internals, not through the public getter — so the count is the number of
 * indexes built.
 */
function countedWorld(): { document: Document; container: Element; walks: () => number } {
  const { document, container } = world(DESIGN_SYSTEM);

  let owner: object | null = document;
  let descriptor: PropertyDescriptor | undefined;
  while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, 'styleSheets'))) {
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  const read = descriptor!.get!;

  let walks = 0;
  Object.defineProperty(document, 'styleSheets', {
    get(this: Document) {
      walks += 1;
      return read.call(this);
    },
    configurable: true,
  });

  return { document, container, walks: () => walks };
}

/** Index rebuilt per subject: what `collect` did for every caller. */
function perSubjectIndex(subjects: number): Regime {
  const { container, walks } = countedWorld();
  const started = performance.now();

  for (let index = 0; index < subjects; index += 1) {
    container.innerHTML = MARKUP;
    collect(container, { ...OPTIONS, subject: { id: `story:s${index}`, kind: 'fixture' } });
  }

  return { ms: performance.now() - started, walks: walks() };
}

/** One index for the document, built inside the measurement because it is paid. */
function sharedIndex(subjects: number): Regime {
  const { document, container, walks } = countedWorld();
  const started = performance.now();

  const shared = indexStyleSheets(document, conditionsFor(document, VIEWPORT));
  for (let index = 0; index < subjects; index += 1) {
    container.innerHTML = MARKUP;
    collect(container, {
      ...OPTIONS,
      subject: { id: `story:s${index}`, kind: 'fixture' },
      index: shared,
    });
  }

  return { ms: performance.now() - started, walks: walks() };
}

/**
 * The share of one subject's collection that is building its index, as the
 * median over `subjects`.
 *
 * `collect` without an index is `indexStyleSheets` followed by `collect` with
 * one, so timing the two halves separately takes the same collection apart
 * rather than running a second one. Both halves of a subject are timed back to
 * back, so load that slows one slows the other; the median drops the subjects a
 * stall landed in.
 */
function indexShare(subjects: number): number {
  const { document, container } = world(DESIGN_SYSTEM);
  const shares: number[] = [];

  for (let index = 0; index < subjects; index += 1) {
    container.innerHTML = MARKUP;
    const started = performance.now();
    const built = indexStyleSheets(document, conditionsFor(document, VIEWPORT));
    const indexed = performance.now();
    collect(container, { ...OPTIONS, subject: { id: `story:s${index}`, kind: 'fixture' }, index: built });
    const finished = performance.now();
    shares.push((indexed - started) / (finished - started));
  }

  shares.sort((left, right) => left - right);
  return shares[Math.floor(shares.length / 2)]!;
}

describe('a DOM that answers `undefined` for a sheet with no owner', () => {
  // The CSSOM says `ownerNode` is `null` when there is no owning element. jsdom
  // below 26 says `undefined`, and says it for every sheet it parses — owned or
  // not. Anything reading the owner has to survive both spellings, because the
  // one it meets is a property of the caller's DOM and not of the page.
  function withUnsetOwners(css: string): Document {
    const { document } = world(css);
    for (const sheet of Array.from(document.styleSheets)) {
      Object.defineProperty(sheet, 'ownerNode', { value: undefined, configurable: true });
    }
    return document;
  }

  it('indexes the page instead of throwing out of a private module', () => {
    const document = withUnsetOwners('.copy { color: rgb(1, 2, 3); }');

    const index = indexStyleSheets(document, conditionsFor(document, VIEWPORT));

    expect(index.totalRules).toBe(1);
    expect(index.byKey.get('.copy')?.length).toBe(1);
  });

  it('still skips the stabilization sheet when the owner is there to be asked', () => {
    const { document } = world('.copy { color: rgb(1, 2, 3); }');
    const injected = document.createElement('style');
    injected.setAttribute(STABILIZE_ATTRIBUTE, '');
    injected.textContent = '*, *::before, *::after { animation: none !important; }';
    document.head.append(injected);

    const index = indexStyleSheets(document, conditionsFor(document, VIEWPORT));

    expect(index.totalRules).toBe(1);
    expect(index.universal).toEqual([]);
  });
});

describe('a stylesheet whose rules cannot be read', () => {
  /**
   * A cross-origin `<link>`, as the CSSOM presents one: reading `cssRules`
   * throws, and nothing else about the sheet says so.
   */
  function withUnreadableSheet(css: string): Document {
    const { document } = world(css);
    const unreadable = document.createElement('style');
    document.head.append(unreadable);
    Object.defineProperty(unreadable.sheet!, 'cssRules', {
      get() {
        throw new DOMException('cross-origin', 'SecurityError');
      },
      configurable: true,
    });
    return document;
  }

  it('indexes the sheets it can read and names the one it cannot', () => {
    const document = withUnreadableSheet('.copy { color: rgb(1, 2, 3); }');

    const index = indexStyleSheets(document, conditionsFor(document, VIEWPORT));

    expect(index.totalRules).toBe(1);
    expect(index.diagnostics.map((entry) => entry.code)).toEqual(['unreadable-stylesheet']);
  });

  it('raises it at the severity that holds a run open', () => {
    // `exitFor` reads the severity and nothing else, so this field is the whole
    // of whether a suite whose design system is served cross-origin is told. Both
    // sides of the comparison drop the same sheet, so the images agree and the
    // verdict is honestly `unchanged` over a subject with a chunk of its styling
    // missing — the one case a verdict cannot express.
    const document = withUnreadableSheet('.copy { color: rgb(1, 2, 3); }');

    const index = indexStyleSheets(document, conditionsFor(document, VIEWPORT));

    expect(index.diagnostics[0]?.severity).toBe('error');
  });
});

describe('the cost of rebuilding the index per subject', () => {
  it('falls materially when one index is shared across the subjects of a document', () => {
    // Warm once so neither side pays for lazy module initialisation.
    perSubjectIndex(2);
    sharedIndex(2);
    indexShare(2);

    const rebuilt = perSubjectIndex(SUBJECTS);
    const shared = sharedIndex(SUBJECTS);
    const longer = sharedIndex(SUBJECTS * 4);
    const share = indexShare(SUBJECTS);

    console.log(
      [
        '',
        `COLLECTION COST (${SUBJECTS} subjects, ${DESIGN_SYSTEM.split('\n').length} CSS rules)`,
        `  index per subject: ${rebuilt.ms.toFixed(0)}ms  (${(rebuilt.ms / SUBJECTS).toFixed(2)}ms each)`,
        `  one shared index:  ${shared.ms.toFixed(0)}ms  (${(shared.ms / SUBJECTS).toFixed(2)}ms each)`,
        `  indexes built:     ${rebuilt.walks} rebuilding, ${shared.walks} shared`,
        `  spent indexing:    ${(share * 100).toFixed(0)}% of a subject's collection, median`,
        `  speedup:           ${(rebuilt.ms / shared.ms).toFixed(1)}×  (reported, not gated — see the todo below)`,
        '',
      ].join('\n'),
    );

    // Half one: the saving, counted. Integers, so a busy machine cannot move
    // them, and the longer run catches an index rebuilt on a threshold rather
    // than per subject, which a fixed-size comparison would not see.
    expect(rebuilt.walks).toBe(SUBJECTS);
    expect(shared.walks).toBe(1);
    expect(longer.walks).toBe(1);

    // Half two: the saving is only worth having if an index costs something.
    // Removing a fraction f of the work is a 1/(1 - f) speedup, so an index that
    // is more than half of every collection makes sharing it better than twice
    // as fast — derived from measured parts of one run rather than by dividing
    // two. The bound is where the trade stops being obviously worth making, not
    // where the reading sits (about two thirds alone).
    expect(share).toBeGreaterThan(0.5);
  });

  // The end-to-end speedup, which is the sentence a reader wants and which
  // nothing here asserts. It divides one separately-timed run by another, and
  // the shared run is the small denominator: a stall of a few hundred
  // milliseconds lands whole in its ~100ms and barely dents the rebuild. Alone
  // the ratio reads about 3×; beside a parallel `yarn test` it read 1.6× to 9×
  // across ten runs, and 0.9× inside one.
  it.todo(
    'sharing one index across a document collects a fixed corpus more than 2× faster than rebuilding it per subject — needs a lane where the measurement has the machine to itself, since the ratio divides two separately-timed runs and a parallel suite moves it from 3× to below 1×',
  );
});
