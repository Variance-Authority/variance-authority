import type { VariationRecord } from '@variance-authority/report';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BuildSummary, SubjectView } from '../review.js';
import { createReviewClient } from './client.js';
import { BuildList, CoverageLine, SubjectPanel, Variations } from './review.js';

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

function summary(
  coverage: BuildSummary['coverage'],
  observed: Partial<BuildSummary['verdicts']> = { unchanged: 3 },
): BuildSummary {
  return {
    project: 'snkr-shop',
    build: '9',
    commit: 'a'.repeat(40),
    at: '2026-08-31T00:00:00.000Z',
    identity: { engine: 'chromium' } as BuildSummary['identity'],
    retention: 'durable',
    verdicts: { changed: 0, new: 0, incomparable: 0, ignored: 0, unchanged: 0, ...observed },
    decided: 0,
    pending: 0,
    coverage,
  };
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

describe('coverage is drawn as a share of the suite, not a count', () => {
  it('says a silent report is unknown rather than clean', () => {
    // The collapse `RunReport.notObserved` exists to prevent, arriving at the
    // last possible moment. `0 failed` for a writer that never said what it
    // skipped is a claim its writer did not make.
    const markup = renderToStaticMarkup(
      <CoverageLine build={summary({ stated: false, failed: 0, excluded: 0, unreached: 0 })} />,
    );

    expect(markup).toContain('coverage is unknown');
    expect(markup).not.toContain('observed');
  });

  it('counts a whole suite against itself rather than reading as a suite of three', () => {
    const markup = renderToStaticMarkup(
      <CoverageLine build={summary({ stated: true, failed: 0, excluded: 0, unreached: 0 })} />,
    );

    expect(text(markup)).toContain('3 of 3 observed');
  });

  it('keeps the eighteen a narrowing skipped in the denominator', () => {
    // The line the narrowing exists to produce. `2 observed` describes a suite
    // of two; the eighteen this change cannot reach are the work, and dropping
    // them from the sentence throws away the only reasoning that saved a render.
    const markup = renderToStaticMarkup(
      <CoverageLine
        build={summary({ stated: true, failed: 0, excluded: 0, unreached: 18 }, { changed: 2 })}
      />,
    );

    expect(text(markup)).toContain('2 of 20 observed');
    expect(text(markup)).toContain('18 not reached by this change');
    // Nothing failed, so nothing is wrong. A narrowing drawn in the alarm colour
    // teaches a reviewer to read the strongest thing the tool does as a defect.
    expect(markup).not.toContain('va-incomplete');
  });

  it('marks a run that failed to render subjects as incomplete', () => {
    const markup = renderToStaticMarkup(
      <CoverageLine build={summary({ stated: true, failed: 50, excluded: 2, unreached: 0 })} />,
    );

    expect(markup).toContain('va-incomplete');
    expect(text(markup)).toContain('50 failed to render');
    expect(text(markup)).toContain('2 excluded by configuration');
  });
});

/** The sentence as a reader receives it, with the numbers' markup taken back out. */
function text(markup: string): string {
  return markup.replace(/<[^>]+>/g, '');
}

describe('a variation that reaches nothing is the one worth reading', () => {
  const lattice: readonly VariationRecord[] = [
    {
      subject: 'story:product-card--control-dark',
      parent: 'story:product-card--control',
      identical: false,
      bands: ['token'],
      how: 'named',
      because: 'differs in token',
    },
    {
      subject: 'story:product-card--orphan',
      because: 'the parent this subject declares was not observed in this run',
    },
    {
      subject: 'story:product-card--sale',
      parent: 'story:product-card--control',
      identical: true,
      bands: [],
      how: 'named',
      because: 'renders identically to `story:product-card--control`',
    },
  ];

  it('leads with the arm whose flag changes no pixel', () => {
    // The finding every tool in this category is blind to: both subjects are
    // `unchanged`, both are green, and the experiment measures nothing. Given in
    // report order — where it is last — it has to come out first.
    const markup = renderToStaticMarkup(<Variations variations={lattice} />);

    const inert = markup.indexOf('story:product-card--sale');
    const unlinked = markup.indexOf('story:product-card--orphan');
    const measured = markup.indexOf('story:product-card--control-dark');

    expect(inert).toBeGreaterThan(-1);
    expect(inert).toBeLessThan(unlinked);
    expect(unlinked).toBeLessThan(measured);
    expect(markup).toContain('reaches nothing');
  });

  it('says a pair nothing compared was not compared, rather than that it differs', () => {
    const markup = renderToStaticMarkup(<Variations variations={[lattice[1]!]} />);

    // `differs` here would report a broken declaration as a measurement, which
    // is the one thing the nullable column exists to keep apart.
    expect(markup).toContain('not compared');
    expect(markup).not.toContain('differs');
    expect(markup).toContain('va-unlinked');
  });

  it('names the axis the run measured rather than a pixel count', () => {
    const markup = renderToStaticMarkup(<Variations variations={[lattice[0]!]} />);

    expect(markup).toContain('token');
    expect(markup).toContain('named');
  });

  it('says nothing at all when no subject declared a parent', () => {
    expect(renderToStaticMarkup(<Variations variations={[]} />)).toBe('');
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

describe('the counts on a build add up to the build', () => {
  const listed = (verdicts: BuildSummary['verdicts'], pending: number): string =>
    renderToStaticMarkup(
      <BuildList
        builds={[
          {
            project: 'snkr-shop',
            build: '7',
            commit: '7fb0870c3ec73ced6d5def786f700b21a62abe45',
            at: '2026-06-02T10:00:00.000Z',
            identity: { renderer: 'playwright-chromium', engine: 'chromium@131' } as never,
            retention: 'durable',
            verdicts,
            decided: 0,
            pending,
            coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
          },
        ]}
        onOpen={() => undefined}
      />,
    );

  it('names every verdict the store keeps, including the declared ones', () => {
    // A twenty-subject build printed as `16 changed · 0 new · 0 incomparable ·
    // 2 unchanged` is eighteen, and the two it dropped are the two a rule
    // decided — which is the half of a run somebody would open this page to
    // audit.
    const markup = listed(
      { changed: 16, new: 0, incomparable: 0, ignored: 2, unchanged: 2 },
      16,
    );

    expect(markup).toContain('2 ignored');
    expect(markup).toContain('16 awaiting review');
  });

  it('prints a verdict nothing landed in rather than dropping the word', () => {
    // Zero here is a measurement: the run compared, and no declaration decided
    // anything. Omitting the word would make the line say nothing about it.
    expect(listed({ changed: 0, new: 0, incomparable: 0, ignored: 0, unchanged: 9 }, 0)).toContain(
      '0 ignored',
    );
  });
});
