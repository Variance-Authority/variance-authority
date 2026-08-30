import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BuildDetail, SubjectView } from '../review-types.js';
import type { Crossing } from './crossing.js';
import { Impact } from './impact.js';
import { divergeFrom } from './shift.js';

/**
 * The build page saying what the build is *of*.
 *
 * Three claims, and each one has a way of overclaiming. A single commit hash on a
 * page whose changes accumulated over two builds invites the reader to blame the
 * last commit. A depth histogram drawn from a scan's blind spots puts the
 * scanner's gaps on the same axis as the commit's consequences. And a file list
 * printed for a run that carried no diff would be a list of nothing presented as
 * a diff that touched nothing.
 */

const LATER = 'b'.repeat(40);

function build(over: Partial<BuildDetail> = {}): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '9',
    commit: LATER,
    branch: 'main',
    at: '2026-08-30T00:00:00.000Z',
    identity: { engine: 'chromium' } as BuildDetail['identity'],
    retention: 'durable',
    verdicts: { changed: 1 } as BuildDetail['verdicts'],
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0 },
    subjects: [
      {
        subject: 'story:product-card--sale',
        verdict: 'changed',
        because: 'the rendered image differs from the baseline',
        changedPixels: 900,
        regions: [],
        moved: [{ component: 'Button', bands: ['token'], cause: true }],
        has: { before: true, after: true, diff: true },
        approvable: true,
        decision: null,
      } satisfies SubjectView,
    ],
    notObserved: [],
    causes: [],
    variations: [],
    declarations: { ignores: null, sensitivities: null },
    reach: {
      against: 'main',
      changed: ['app/tokens.css', 'ui/button.tsx'],
      components: [
        { component: 'Button', trail: ['ui/button.tsx', 'Button'] },
        { component: 'Card', trail: ['ui/button.tsx', 'ui/card.tsx', 'Card'] },
      ],
    },
    ...over,
  };
}

const ALONE: Crossing = { state: 'none' };

function after(commit: string): Crossing {
  const earlier = build({ build: '8', commit });
  return {
    state: 'ready',
    earlier,
    divergence: divergeFrom(build(), earlier),
    of: () => undefined,
  };
}

function draw(crossing: Crossing, over: Partial<BuildDetail> = {}): string {
  return renderToStaticMarkup(<Impact build={build(over)} crossing={crossing} />);
}

describe('what this build is a build of', () => {
  it('prints a range when a build came before it, not one hash', () => {
    // Two builds apart, the changes on this page are the consequence of
    // everything between them. One hash invites the reader to blame the last.
    const html = draw(after('a'.repeat(40)));

    expect(html).toContain('aaaaaaaa');
    expect(html).toContain('bbbbbbbb');
    expect(html).toContain('everything since build 8');
  });

  it('prints one hash when the build before it was the same commit', () => {
    expect(draw(after(LATER))).not.toContain('everything since');
  });

  it('names the files the commit changed, and what it was read against', () => {
    const html = draw(ALONE);

    expect(html).toContain('2 files changed against');
    expect(html).toContain('ui/button.tsx');
  });

  it('says no diff was read rather than printing an empty file list', () => {
    const html = draw(ALONE, { reach: null });

    expect(html).toContain('No diff was read');
    expect(html).not.toContain('0 files changed');
  });

  it('carries the refusal through when the run could not attribute its diff', () => {
    const html = draw(ALONE, {
      reach: { ...build().reach!, whole: 'the merge base could not be resolved' },
    });

    expect(html).toContain('the merge base could not be resolved');
  });
});

describe('how far the edit landed', () => {
  it('leads with the depth movement reached, not with the bars', () => {
    expect(draw(ALONE)).toContain('Movement in what the commit declares stops at the files it changed');
  });

  it('names what moved that the diff declares nowhere, off the axis', () => {
    const html = draw(ALONE, {
      subjects: [
        {
          ...build().subjects[0]!,
          moved: [{ component: 'CardFooter', bands: ['content'], cause: true }],
        },
      ],
    });

    expect(html).toContain('1 component moved that no file in this commit declares');
    expect(html).toContain('CardFooter');
  });

  it('names the depth when the movement is further out than the edit', () => {
    const html = draw(ALONE, {
      subjects: [
        {
          ...build().subjects[0]!,
          moved: [{ component: 'Card', bands: ['geometry'], cause: true }],
        },
      ],
    });

    expect(html).toContain('Movement reaches 1 import out');
  });

  it('draws no histogram at all when there was no graph to measure in', () => {
    expect(draw(ALONE, { reach: null })).not.toContain('va-rungs');
  });
});
