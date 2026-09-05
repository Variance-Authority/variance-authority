// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildDetail, BuildSummary, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { DivergencePanel } from './divergence.js';
import { divergeFrom } from './shift.js';

/**
 * Two runs crossed, held to the one thing that makes the crossing worth anything:
 * it must never say *you have seen this before* about a pair nothing measured.
 *
 * That is the sentence a reviewer skips a render on. Every other state here is
 * ordinary bookkeeping; `again` is a claim, and it is only ever licensed by two
 * shapes that both exist and match.
 *
 * The panel's own logic is an effect, so it is mounted rather than rendered
 * statically — the branch worth the most is the one where the earlier run could
 * not be fetched, and a static render never reaches it.
 */

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

function shaped(fingerprint: string | undefined): SubjectView['regions'] {
  return [
    {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      pixels: 100,
      cause: true,
      component: 'Button',
      ...(fingerprint === undefined ? {} : { fingerprint }),
    },
  ];
}

function build(id: string, subjects: readonly SubjectView[]): BuildDetail {
  return {
    project: 'snkr-shop',
    build: id,
    commit: `commit${id}0000000`,
    at: '2026-06-01T12:00:00.000Z',
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131' } as never,
    retention: 'durable',
    verdicts: { changed: 1, unchanged: 0, new: 0, incomparable: 0, unstable: 0, ignored: 0, failed: 0 },
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    subjects,
    notObserved: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: null,
    causes: [],
    variations: [],
    reach: null,
    journeys: null,
  };
}

function shiftOf(now: SubjectView, earlier: SubjectView): string | undefined {
  return divergeFrom(build('6', [now]), build('5', [earlier])).shifts[0]?.shift;
}

describe('the same difference again is a claim, and needs two shapes to make it', () => {
  it('says a difference is the one the earlier run carried when the shapes match', () => {
    expect(shiftOf(subject({ regions: shaped('v1:aaa') }), subject({ regions: shaped('v1:aaa') }))).toBe(
      'again',
    );
  });

  it('says the difference has changed when the shapes differ', () => {
    expect(shiftOf(subject({ regions: shaped('v1:aaa') }), subject({ regions: shaped('v1:bbb') }))).toBe(
      'differently',
    );
  });

  it('refuses to call two silences a match', () => {
    // Neither run localised a shape. Both said nothing, and nothing is not a
    // value two runs can agree on — reporting `again` here would tell a reviewer
    // they have already seen a difference no run ever characterised.
    expect(shiftOf(subject({ regions: shaped(undefined) }), subject({ regions: shaped(undefined) }))).toBe(
      'unsaid',
    );
  });

  it('refuses when only one of the two runs recorded a shape', () => {
    expect(shiftOf(subject({ regions: shaped('v1:aaa') }), subject({ regions: shaped(undefined) }))).toBe(
      'unsaid',
    );
  });

  it('reads the first region the report marked, not the largest', () => {
    // The docket, the rail and the map all file a subject under the first marked
    // region. A crossing that ranked by area would compare the container that
    // reflowed against the edit that moved it, and call two identical runs
    // different.
    const wide = { x: 0, y: 0, width: 900, height: 900, pixels: 810000, component: 'Page' };
    const now = subject({ regions: [...shaped('v1:aaa'), wide] });
    const then = subject({ regions: [...shaped('v1:aaa'), { ...wide, fingerprint: 'v1:zzz' }] });

    expect(shiftOf(now, then)).toBe('again');
  });
});

describe('a verdict that describes no comparison is never placed on the axis', () => {
  it('does not call a first difference *first* when the earlier run never compared it', () => {
    // Build 1 records every subject as `new`. Saying *this moved for the first
    // time* against a run that had no baseline is an inference from an absence.
    expect(shiftOf(subject({ verdict: 'changed' }), subject({ verdict: 'new', changedPixels: 0 }))).toBe(
      'unplaced',
    );
  });

  it('sets aside a subject this run did not compare', () => {
    expect(shiftOf(subject({ verdict: 'incomparable' }), subject({ verdict: 'changed' }))).toBe(
      'uncompared',
    );
  });

  it('names a subject the earlier run had and this one lost', () => {
    const crossed = divergeFrom(build('6', []), build('5', [subject({ subject: 'story:gone' })]));

    expect(crossed.shifts.map((each) => [each.subject, each.shift])).toEqual([['story:gone', 'dropped']]);
  });

  it('counts the subjects neither run found anything in rather than listing them', () => {
    const quiet = subject({ verdict: 'unchanged', changedPixels: 0 });
    const crossed = divergeFrom(build('6', [quiet]), build('5', [quiet]));

    expect(crossed.shifts).toEqual([]);
    expect(crossed.held).toBe(1);
  });

  it('reports a subject that stopped moving', () => {
    expect(shiftOf(subject({ verdict: 'unchanged', changedPixels: 0 }), subject())).toBe('settled');
  });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A client answering the two calls this panel makes, and refusing every other. */
function clientThat(
  builds: () => Promise<readonly BuildSummary[]>,
  detail?: (id: string) => Promise<BuildDetail>,
): ReviewClient {
  const refuse = (): never => {
    throw new Error('the crossing reads the build list and one earlier build, nothing else');
  };

  return {
    builds,
    build: detail ?? refuse,
    changelog: refuse,
    churn: refuse,
    reach: refuse,
    flakiness: refuse,
    lastChanged: refuse,
    decide: refuse,
    sweep: refuse,
    imageUrl: () => '',
  } as unknown as ReviewClient;
}

async function mount(client: ReviewClient, now: BuildDetail): Promise<string> {
  await act(async () => {
    root.render(<DivergencePanel client={client} build={now} />);
  });
  return host.innerHTML;
}

describe('what the earlier run decided is part of the finding', () => {
  const now = build('6', [subject({ regions: shaped('v1:aaa') })]);
  const listing = async (): Promise<readonly BuildSummary[]> => [build('6', []), build('5', [])];

  it('says nobody decided a difference that has now arrived twice', async () => {
    const markup = await mount(
      clientThat(listing, async () => build('5', [subject({ regions: shaped('v1:aaa') })])),
      now,
    );

    expect(markup).toContain('The same difference, again');
    expect(markup).toContain('undecided in build 5');
  });

  it('carries an earlier approval onto the row, because an identical difference then means it never landed', async () => {
    const markup = await mount(
      clientThat(listing, async () =>
        build('5', [
          subject({
            regions: shaped('v1:aaa'),
            decision: { decision: 'approved', by: 'marina', at: '2026-06-01T09:00:00.000Z' },
          }),
        ]),
      ),
      now,
    );

    expect(markup).toContain('approved in build 5 by marina');
  });

  it('says the earlier run could not be read rather than showing an empty section', async () => {
    // Silence here reads as *nothing has changed since the last run*, which is
    // the one sentence this panel exists to stop somebody merging on.
    const markup = await mount(
      clientThat(async () => {
        throw new Error('the service answered 503');
      }),
      now,
    );

    expect(markup).toContain('could not be read');
    expect(markup).toContain('503');
  });

  it('says there is no earlier run rather than crossing this one against nothing', async () => {
    const markup = await mount(
      clientThat(async () => [build('6', [])]),
      now,
    );

    expect(markup).toContain('no earlier run');
  });

  it('does not open with a count of zero when nothing here is new', async () => {
    // The ordinary reading of a healthy branch. `0 subjects here are something`
    // is a sentence a reader has to parse twice to learn nothing happened.
    const markup = await mount(
      clientThat(listing, async () => build('5', [subject({ regions: shaped('v1:aaa') })])),
      now,
    );

    expect(markup).toContain('Nothing here is something that run did not show you');
    expect(markup).toContain('1 subject carries a difference it already had');
  });

  it('picks the run before this one by position, because two pushes can share a timestamp', async () => {
    // Builds 5 and 6 in the example repository carry the same `at` to the
    // millisecond. Picking by clock would compare this build against itself.
    const asked: string[] = [];
    await mount(
      clientThat(listing, async (id) => {
        asked.push(id);
        return build('5', [subject({ regions: shaped('v1:aaa') })]);
      }),
      now,
    );

    expect(asked).toEqual(['5']);
  });
});

describe('a declaration decided it, and that is not the same as nobody comparing it', () => {
  const declared = (overrides: Partial<SubjectView> = {}): SubjectView =>
    subject({
      verdict: 'ignored',
      because: 'every differing pixel fell inside an excluded subtree',
      changedPixels: 0,
      approvable: false,
      ...overrides,
    });

  it('does not file a subject a rule absorbed with the ones nothing compared', () => {
    // The bug this pair exists for. `ignored` was not in `compared`, so both
    // directions fell through to the uncompared branches and the page told a
    // reviewer *no baseline was put beside them here* about two subjects that
    // were compared, differed, and were decided by a rule they had written.
    expect(shiftOf(declared(), declared())).toBe('declared');
    expect(shiftOf(declared(), declared())).not.toBe('uncompared');
  });

  it('names a subject a rule has just taken out of review', () => {
    expect(shiftOf(declared(), subject())).toBe('absorbed');
  });

  it('names a subject a rule has stopped absorbing', () => {
    expect(shiftOf(subject(), declared())).toBe('unmasked');
  });

  it('calls a subject that stopped differing settled, whether or not a rule was watching', () => {
    // Not `unmasked`. The rule did not fail to cover anything; there was nothing
    // left to cover, and a page that cried about a mask here would be crying on
    // the run where the underlying difference went away.
    expect(shiftOf(subject({ verdict: 'unchanged', changedPixels: 0 }), declared())).toBe('settled');
  });

  it('counts a newly-reported subject as one the earlier run did not show', async () => {
    const markup = await mount(
      clientThat(
        async () => [build('6', []), build('5', [])],
        async () => build('5', [declared({ regions: shaped('v1:aaa') })]),
      ),
      build('6', [subject({ regions: shaped('v1:aaa') })]),
    );

    expect(markup).toContain('A rule stopped absorbing these');
    expect(markup).toContain('1 subject here is something that run did not show you');
  });

  it('names the rule on the row, from the block the build stored', async () => {
    const markup = await mount(
      clientThat(
        async () => [build('6', []), build('5', [])],
        async () => build('5', [subject()]),
      ),
      build('6', [
        declared({
          ignored: { pixels: 325, boxes: 1, inert: 0, byRule: { 'nav-cart-badge': 325 } },
        }),
      ]),
    );

    expect(markup).toContain('nav-cart-badge');
    expect(markup).toContain('325 px absorbed');
  });

  it('says the rule is unrecorded rather than implying the difference was small', async () => {
    // A build pushed before the store kept the per-subject block. The verdict
    // says a declaration absorbed it and the record does not say which one, and
    // a blank there reads as a difference too small to name.
    const markup = await mount(
      clientThat(
        async () => [build('6', []), build('5', [])],
        async () => build('5', [subject()]),
      ),
      build('6', [declared()]),
    );

    expect(markup).toContain('does not record which rule');
  });
});
