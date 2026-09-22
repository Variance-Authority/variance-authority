import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Viewport } from '@variance-authority/core/format';
import { collect, conditionsFor } from './collect.js';
import { indexStyleSheets } from './css.js';

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

const OPTIONS = {
  subject: { id: 'story:card--default', kind: 'fixture' as const },
  viewport: VIEWPORT,
  engine: 'jsdom@test',
  fonts: ['Inter/400/normal/deadbeef'],
};

/**
 * A page's worth of CSS: a component library, utilities, dead rules and
 * conditional groups. Roughly 600 rules exist and a dozen match the subject.
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

function world(): { document: Document; container: Element } {
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${DESIGN_SYSTEM}</style></head>` +
      '<body><div id="canvas"></div></body></html>',
  );
  const document = dom.window.document as unknown as Document;
  return { document, container: document.getElementById('canvas')! };
}

/** Index rebuilt per subject: what `collect` did for every caller. */
function perSubjectIndex(subjects: number): number {
  const { container } = world();
  const started = performance.now();

  for (let index = 0; index < subjects; index += 1) {
    container.innerHTML = MARKUP;
    collect(container, { ...OPTIONS, subject: { id: `story:s${index}`, kind: 'fixture' } });
  }

  return performance.now() - started;
}

/** One index for the document, built inside the measurement because it is paid. */
function sharedIndex(subjects: number): number {
  const { document, container } = world();
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

  return performance.now() - started;
}

describe('the cost of rebuilding the index per subject', () => {
  it('falls materially when one index is shared across the subjects of a document', () => {
    perSubjectIndex(2);
    sharedIndex(2);

    const rebuiltMs = perSubjectIndex(SUBJECTS);
    const sharedMs = sharedIndex(SUBJECTS);
    const ratio = rebuiltMs / sharedMs;

    console.log(
      [
        '',
        `COLLECTION COST (${SUBJECTS} subjects, ${DESIGN_SYSTEM.split('\n').length} CSS rules)`,
        `  index per subject: ${rebuiltMs.toFixed(0)}ms  (${(rebuiltMs / SUBJECTS).toFixed(2)}ms each)`,
        `  one shared index:  ${sharedMs.toFixed(0)}ms  (${(sharedMs / SUBJECTS).toFixed(2)}ms each)`,
        `  speedup:           ${ratio.toFixed(1)}×`,
        '',
      ].join('\n'),
    );

    // The claim is that the index stopped dominating, not one exact multiple.
    expect(ratio).toBeGreaterThan(2);
  });
});
