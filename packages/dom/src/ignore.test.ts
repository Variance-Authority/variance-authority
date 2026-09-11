// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '@variance-authority/core/compare';
import type { SemanticSnapshot, Viewport } from '@variance-authority/core/format';
import { applyIgnores, type IgnoreRule } from '@variance-authority/core/judge';
import { normalize } from '@variance-authority/core/rules';
import { collect } from './collect.js';
import { IGNORE_ATTRIBUTE, MARKED_RULE, resolveIgnores } from './ignore.js';

/**
 * The whole ignore path, from a selector to a verdict, on a real document.
 *
 * The unit tests either side of this prove that a selector resolves and that a
 * delta is absorbed. What only a document can answer is whether the two halves
 * agree about *which node* — a path recorded before wrapper collapse names a
 * different element afterwards, and an ignore that slid one level up silences a
 * sibling nobody excluded. That failure is invisible to both unit suites and it
 * is the first test here.
 */

const VIEWPORT: Viewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  colorScheme: 'light',
};

const options = {
  subject: { id: 'route:/dashboard', kind: 'route' as const },
  viewport: VIEWPORT,
  engine: 'jsdom@test',
  fonts: ['Inter/400/normal/deadbeef'],
};

function render(html: string): Element {
  document.body.innerHTML = `<div id="canvas">${html}</div>`;
  return document.getElementById('canvas')!;
}

function snapshot(html: string, ignore?: { id: string; select: string }[]): SemanticSnapshot {
  return normalize(collect(render(html), { ...options, ...(ignore ? { ignore } : {}) }));
}

/** A page with a clock and a button, the clock wrapped in layout divs. */
const page = (time: string, label: string) => `
  <header>
    <div class="row"><div class="cell"><time class="clock">${time}</time></div></div>
  </header>
  <main><button>${label}</button></main>
`;

const CLOCK: IgnoreRule = { id: 'clock', reason: 'wall time' };

describe('a selector, through normalization, to a verdict', () => {
  it('absorbs the clock and reports the button beside it', () => {
    const ignore = [{ id: 'clock', select: '.clock' }];

    const before = snapshot(page('09:41', 'Refresh'), ignore);
    const after = snapshot(page('11:02', 'Reload'), ignore);

    const diff = diffSnapshots(before, after);
    const sites = { [diff.subjectId]: after.ignoreSites ?? [] };
    const { diffs, register } = applyIgnores([diff], [CLOCK], { sites });

    expect(register.totalAbsorbed).toBeGreaterThan(0);
    expect(register.absorbed[0]!.rule).toBe('clock');

    const surviving = diffs[0]!.deltas.map((delta) => delta.to ?? delta.from ?? '');
    expect(surviving.some((value) => value.includes('Reload'))).toBe(true);
    expect(surviving.some((value) => value.includes('11:02'))).toBe(false);
  });

  it('resolves the site against the tree that survived wrapper collapse', () => {
    // The failure this file exists for. The clock sits under two inert wrappers,
    // which normalization removes; a path recorded during the walk would point
    // at a node that is no longer there.
    const after = snapshot(page('11:02', 'Refresh'), [{ id: 'clock', select: '.clock' }]);
    const site = after.ignoreSites?.[0];

    expect(site).toBeDefined();

    const nodeAt = (path: string) => {
      let node = after.root;
      for (const step of path.split('/').slice(1)) node = node.children[Number(step)]!;
      return node;
    };

    expect(nodeAt(site!.path).tag).toBe('time');
  });

  it('does not change the render hash, so no baseline is invalidated', () => {
    // The contract that decides whether anyone dares add an ignore. Masking a
    // clock must not re-baseline the repository.
    const plain = snapshot(page('09:41', 'Refresh'));
    const ignored = snapshot(page('09:41', 'Refresh'), [{ id: 'clock', select: '.clock' }]);

    expect(ignored.renderHash).toBe(plain.renderHash);
    expect(ignored.structureHash).toBe(plain.structureHash);
    expect(ignored.ignoreSites).toHaveLength(1);
  });

  it('keeps the excluded element in the capture rather than deleting it', () => {
    // An element dropped from the capture would be absent from every count, and
    // "absorbed" would be indistinguishable from "was never there".
    const ignored = snapshot(page('09:41', 'Refresh'), [{ id: 'clock', select: '.clock' }]);
    const text = JSON.stringify(ignored.root);

    expect(text).toContain('09:41');
  });

  it('reports a selector that matched nothing', () => {
    const capture = collect(render(page('09:41', 'Refresh')), {
      ...options,
      ignore: [{ id: 'carousel', select: '.carousel' }],
    });

    expect(capture.diagnostics.map((d) => d.code)).toContain('ignore-unmatched');
  });
});

describe('a marked element that is otherwise an inert wrapper', () => {
  it('survives wrapper collapse, so the exclusion does not evaporate', () => {
    // The shape normalization deletes: a bare `<div>` with no role, no
    // attributes and nothing declared. The mark is not an attribute — it is kept
    // out of the allowlist on purpose so adding one re-baselines nothing — so
    // nothing else in `isInertWrapper` can see it. Collapsed, the site is gone,
    // the region is compared, and the operator's config says otherwise.
    const marked = normalize(
      collect(render(`<div ${IGNORE_ATTRIBUTE}="feed"><p>live</p></div>`), options),
    );

    expect(marked.ignoreSites?.map((site) => site.rule)).toEqual(['feed']);
  });

  it('still collapses the same wrapper when nothing marked it', () => {
    // The control. A rule that kept every wrapper would be indistinguishable
    // from switching collapse off, which journal 0005 measured as the single
    // largest source of structural churn.
    const plain = normalize(collect(render('<div><p>live</p></div>'), options));
    const inner = normalize(collect(render('<p>live</p>'), options));

    expect(plain.structureHash).toBe(inner.structureHash);
  });
});

describe('the markup marker', () => {
  it('records the attribute value as the rule id', () => {
    const root = render(`<p ${IGNORE_ATTRIBUTE}="carousel">x</p>`);
    const { marks } = resolveIgnores(root);

    expect([...marks.values()]).toEqual([['carousel']]);
  });

  it('falls back to a named rule rather than to nothing when the value is empty', () => {
    const root = render(`<p ${IGNORE_ATTRIBUTE}>x</p>`);
    const { marks } = resolveIgnores(root);

    expect([...marks.values()]).toEqual([[MARKED_RULE]]);
  });

  it('is not in the attribute allowlist, so adding it moves no hash', () => {
    const plain = normalize(collect(render('<p>x</p>'), options));
    const marked = normalize(collect(render(`<p ${IGNORE_ATTRIBUTE}="c">x</p>`), options));

    expect(marked.renderHash).toBe(plain.renderHash);
    expect(marked.ignoreSites).toHaveLength(1);
  });
});

describe('what the collector refuses to do with a bad selector', () => {
  it('reports it as unmatched instead of failing the capture', () => {
    // A typo in an ignore must not be the most dangerous edit in the repository.
    const root = render('<p>x</p>');
    const { unmatched, marks } = resolveIgnores(root, {
      selectors: [{ id: 'broken', select: '::::' }],
    });

    expect(unmatched.map((s) => s.id)).toEqual(['broken']);
    expect(marks.size).toBe(0);
  });

  it('matches the subject root itself, which querySelectorAll cannot', () => {
    const root = render('<p>x</p>');
    const { marks } = resolveIgnores(root, {
      selectors: [{ id: 'whole', select: '#canvas' }],
    });

    expect(marks.get(root)).toEqual(['whole']);
  });
});
