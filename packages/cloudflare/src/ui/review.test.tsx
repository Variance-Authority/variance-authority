import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BuildSummary, Cause, SubjectView } from '../review.js';
import { createReviewClient } from './client.js';
import { CoverageLine, Docket, RegionOverlay, SubjectPanel, Viewer, modesFor } from './review.js';

/**
 * What is worth testing in a review surface, and what is not.
 *
 * Not the layout, not the class names, and not that a button is a button. What is
 * tested here is every place the markup could tell a reviewer something untrue —
 * because this is the last surface between an observation and a person deciding
 * to merge, and a sentence that is wrong here is wrong at the only moment it
 * matters.
 *
 * Rendered with `renderToStaticMarkup`, which is the initial render and nothing
 * more. That is exactly the interesting frame: it is what a reviewer sees before
 * they have interacted with anything, and it is where a default that lies would
 * do its damage.
 */

const CLIENT = createReviewClient({ endpoint: '/api', token: 'unused-in-a-static-render' });

function summary(coverage: BuildSummary['coverage']): BuildSummary['coverage'] {
  return coverage;
}

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:card',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 1530,
    regions: [],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...overrides,
  };
}

describe('coverage is drawn as three states, not two', () => {
  it('says a silent report is unknown rather than clean', () => {
    // The collapse `RunReport.notObserved` exists to prevent, arriving at the
    // last possible moment. `0 failed` for a writer that never said what it
    // skipped is a claim its writer did not make.
    const markup = renderToStaticMarkup(
      <CoverageLine coverage={summary({ stated: false, failed: 0, excluded: 0 })} />,
    );

    expect(markup).toContain('coverage is unknown');
    expect(markup).not.toContain('Every planned subject');
  });

  it('says clean only when the report claimed it', () => {
    const markup = renderToStaticMarkup(
      <CoverageLine coverage={summary({ stated: true, failed: 0, excluded: 0 })} />,
    );

    expect(markup).toContain('Every planned subject was observed');
  });

  it('marks a run that failed to render subjects as incomplete', () => {
    const markup = renderToStaticMarkup(
      <CoverageLine coverage={summary({ stated: true, failed: 50, excluded: 2 })} />,
    );

    expect(markup).toContain('va-incomplete');
    expect(markup).toContain('50 failed to render');
  });
});

describe('the docket leads with causes and counts collateral', () => {
  const causes: readonly Cause[] = [
    {
      component: 'Toggle',
      file: 'src/ds/components.tsx',
      subjects: ['story:card'],
      pixels: 86,
      collateralPixels: 511,
    },
  ];

  it('names the component and the file it is declared in', () => {
    const markup = renderToStaticMarkup(<Docket causes={causes} />);

    // The third column of the docket is the point. A reviewer who is told
    // `Toggle` and `src/ds/components.tsx` can hand the change to whoever owns
    // the file.
    expect(markup).toContain('Toggle');
    expect(markup).toContain('src/ds/components.tsx');
  });

  it('counts collateral rather than listing it', () => {
    const markup = renderToStaticMarkup(<Docket causes={causes} />);

    expect(markup).toContain('511 collateral pixels');
  });

  it('does not invent a cause when the tier named none', () => {
    const markup = renderToStaticMarkup(<Docket causes={[]} />);

    expect(markup).toContain('No component was named as a cause');
  });
});

describe('the viewer offers only comparisons this build can make', () => {
  it('leads with regions when the build kept a candidate and its boxes', () => {
    const withRegions = subject({
      size: { width: 100, height: 50 },
      regions: [{ x: 0, y: 0, width: 10, height: 10, pixels: 86, component: 'Toggle', cause: true }],
    });

    expect(modesFor(withRegions)[0]).toBe('regions');
  });

  it('offers no swipe when there is no baseline image to swipe against', () => {
    // A mode whose image does not exist renders a broken frame, and a broken
    // frame in a review surface reads as a subject that renders to nothing.
    const newSubject = subject({ verdict: 'new', has: { before: false, after: true, diff: false } });

    expect(modesFor(newSubject)).not.toContain('swipe');
  });

  it('says so plainly when the run kept nothing to look at', () => {
    const markup = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="ci-1"
        subject={subject({ has: { before: false, after: false, diff: false } })}
      />,
    );

    expect(markup).toContain('kept no images');
  });

  it('reports regions that were found and not recorded', () => {
    const markup = renderToStaticMarkup(
      <Viewer
        client={CLIENT}
        build="ci-1"
        subject={subject({ truncated: { regions: 12, pixels: 900 } })}
      />,
    );

    // Never silently dropped. A docket that showed five regions when eleven were
    // found is a docket a reviewer would trust as complete.
    expect(markup).toContain('12 further regions');
  });
});

describe('region boxes are placed from the raster’s own dimensions', () => {
  it('positions cause and collateral distinctly', () => {
    const markup = renderToStaticMarkup(
      <RegionOverlay
        subject={subject({
          size: { width: 200, height: 100 },
          regions: [
            { x: 20, y: 10, width: 40, height: 20, pixels: 86, component: 'Toggle', cause: true },
            { x: 0, y: 50, width: 200, height: 50, pixels: 511, component: 'Stack', cause: false },
          ],
        })}
      />,
    );

    expect(markup).toContain('left:10%');
    expect(markup).toContain('va-cause');
    expect(markup).toContain('va-collateral');
    // Cause and collateral must not read as the same finding — which is exactly
    // the mistake ranking by area makes.
    expect(markup).toContain('Stack (collateral)');
  });

  it('draws nothing when the build did not carry the candidate size', () => {
    const markup = renderToStaticMarkup(
      <RegionOverlay
        subject={subject({
          regions: [{ x: 0, y: 0, width: 1, height: 1, pixels: 1, cause: true }],
        })}
      />,
    );

    // The alternative is guessing a scale, and a box in the wrong place is worse
    // than no box: it attributes a change to whatever it lands on.
    expect(markup).toBe('');
  });
});

describe('what a reviewer is allowed to do', () => {
  it('disables approve for a subject with no candidate and says why', () => {
    const markup = renderToStaticMarkup(
      <SubjectPanel
        client={CLIENT}
        reviewer="marina"
        build="ci-1"
        subject={subject({ approvable: false, has: { before: true, after: false, diff: false } })}
        onDecided={() => undefined}
      />,
    );

    expect(markup).toContain('disabled');
    expect(markup).toContain('cannot be approved here');
  });

  it('distinguishes a render that was inspected and clean from one nothing looked at', () => {
    const unexamined = renderToStaticMarkup(
      <SubjectPanel
        client={CLIENT}
        reviewer="marina"
        build="ci-1"
        subject={subject()}
        onDecided={() => undefined}
      />,
    );
    const inspected = renderToStaticMarkup(
      <SubjectPanel
        client={CLIENT}
        reviewer="marina"
        build="ci-1"
        subject={subject({ findings: [] })}
        onDecided={() => undefined}
      />,
    );

    expect(unexamined).toContain('was not inspected');
    expect(inspected).not.toContain('was not inspected');
  });

  it('shows the decision already on record', () => {
    const markup = renderToStaticMarkup(
      <SubjectPanel
        client={CLIENT}
        reviewer="marina"
        build="ci-1"
        subject={subject({
          decision: { decision: 'rejected', by: 'marina', at: '2026-06-01T12:00:00.000Z' },
        })}
        onDecided={() => undefined}
      />,
    );

    expect(markup).toContain('rejected by marina');
  });
});

describe('the client never reads a failure as an answer', () => {
  it('throws rather than returning an empty list', async () => {
    const client = createReviewClient({
      endpoint: '/api',
      token: 'x',
      fetch: async () => new Response('the database is unavailable', { status: 500 }),
    });

    // `[]` here is the sentence "no builds need review", which is what somebody
    // merges on.
    await expect(client.builds()).rejects.toThrow(/answered 500/);
  });

  it('addresses an image without fetching it', () => {
    expect(CLIENT.imageUrl('ci 1', 'story:card', 'diff')).toBe(
      '/api/review/builds/ci%201/subjects/story%3Acard/diff.png',
    );
  });
});
