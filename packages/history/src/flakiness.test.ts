import { describe, expect, it } from 'vitest';
import { accumulateFlakiness, describeFlakiness } from './flakiness.js';
import type { Instability } from './instability.js';
import type { RunRecord } from './observation.js';

/**
 * How often a subject has failed to read the same way twice.
 *
 * Every test here is about a number that is *believable when wrong*. A flake rate
 * with the wrong denominator, a "fixed" that counts calendar time instead of
 * examinations, an absorbed occurrence folded into the finding count — each one
 * produces a page that looks exactly like a correct one and sends somebody to the
 * wrong place for a day.
 */

function run(fields: Partial<RunRecord> = {}): RunRecord {
  return {
    project: 'shop',
    run: 'r1',
    commit: 'c1',
    profile: 'chromium',
    at: '2026-03-01T10:00:00.000Z',
    ...fields,
  };
}

function occurrence(fields: Partial<Instability> = {}): Instability {
  return {
    project: 'shop',
    subject: 'story:checkout--summary',
    component: 'Clock',
    band: 'content',
    profile: 'chromium',
    commit: 'c1',
    run: 'r1',
    at: '2026-03-01T10:00:00.000Z',
    ...fields,
  };
}

const SUBJECT = 'story:checkout--summary';

describe('flakiness over a window', () => {
  it('divides by sweeps rather than by runs, because only a sweep asked', () => {
    // The defect this exists to prevent: a subject that flakes every single time
    // anybody looks, reported as flaking one run in ten, because the other nine
    // runs never read it twice at all.
    const runs = [
      run({ run: 'a', swept: true, at: '2026-03-01T00:00:00.000Z' }),
      run({ run: 'b', swept: true, at: '2026-03-02T00:00:00.000Z' }),
      ...Array.from({ length: 8 }, (_, index) =>
        run({ run: `q${index}`, swept: false, at: `2026-03-0${index + 1}T12:00:00.000Z` }),
      ),
    ];

    const answer = accumulateFlakiness({
      subject: SUBJECT,
      runs,
      occurrences: [
        occurrence({ run: 'a', at: '2026-03-01T00:00:00.000Z' }),
        occurrence({ run: 'b', at: '2026-03-02T00:00:00.000Z' }),
      ],
    });

    expect([answer.runs, answer.sweeps, answer.occurrences]).toEqual([10, 2, 2]);
    expect(answer.rate).toBe(1);
  });

  it('reports no rate at all when nothing ever swept, rather than zero', () => {
    // Absent, never zero. A rate of 0 next to a subject a run has just called
    // unstable is the sentence "this has never happened before", and nobody
    // reading it would know the question was not asked.
    const answer = accumulateFlakiness({
      subject: SUBJECT,
      runs: [run({ run: 'a' }), run({ run: 'b', at: '2026-03-02T00:00:00.000Z' })],
      occurrences: [occurrence({ run: 'a' })],
    });

    expect(answer.rate).toBeUndefined();
    expect(answer.occurrences).toBe(1);
    expect(describeFlakiness(answer)).toContain('no sweep in this window');
  });

  it('counts how many sweeps have not seen it since, which is what says "fixed"', () => {
    // "Unstable in 2 of 12" and "twice, and the last 9 sweeps were clean" are
    // opposite instructions. Counted in sweeps rather than in days, so a suite
    // that stopped running does not look increasingly healthy.
    const runs = [
      run({ run: 'old', swept: true, at: '2026-03-01T00:00:00.000Z' }),
      ...Array.from({ length: 9 }, (_, index) =>
        run({ run: `s${index}`, swept: true, at: `2026-03-${String(index + 2).padStart(2, '0')}T00:00:00.000Z` }),
      ),
    ];

    const answer = accumulateFlakiness({
      subject: SUBJECT,
      runs,
      occurrences: [occurrence({ run: 'old', at: '2026-03-01T00:00:00.000Z' })],
    });

    expect(answer.sweepsSince).toBe(9);
    expect(answer.lastRun).toBe('old');
    expect(describeFlakiness(answer)).toContain('9 sweep(s) have not seen it since');
  });

  it('keeps an absorbed occurrence out of the findings and still counts it', () => {
    // A route that declared it asserts on layout is not lying when its clock
    // ticks: that never gates. It is still recorded, because a rule absorbing
    // something in every run for six months is worth being able to ask about.
    const answer = accumulateFlakiness({
      subject: SUBJECT,
      runs: [run({ run: 'a', swept: true }), run({ run: 'b', swept: true, at: '2026-03-02T00:00:00.000Z' })],
      occurrences: [
        occurrence({ run: 'a', absorbedBy: 'routes' }),
        occurrence({ run: 'b', at: '2026-03-02T00:00:00.000Z', absorbedBy: 'routes' }),
      ],
    });

    expect([answer.occurrences, answer.absorbedRuns]).toEqual([0, 2]);
    expect(describeFlakiness(answer)).toContain('working as declared');
  });

  it('counts one run once however many components read differently in it', () => {
    const answer = accumulateFlakiness({
      subject: SUBJECT,
      runs: [run({ run: 'a', swept: true })],
      occurrences: [
        occurrence({ run: 'a', component: 'Clock', band: 'content' }),
        occurrence({ run: 'a', component: 'Header', band: 'geometry' }),
      ],
    });

    // One run that disagreed with itself, two things to fix.
    expect(answer.occurrences).toBe(1);
    expect(answer.rate).toBe(1);
    expect(answer.causes.map((cause) => `${cause.component}/${cause.band}`)).toEqual([
      'Clock/content',
      'Header/geometry',
    ]);
  });

  it('ranks causes by how many runs each was seen in', () => {
    const runs = ['a', 'b', 'c'].map((id, index) =>
      run({ run: id, swept: true, at: `2026-03-0${index + 1}T00:00:00.000Z` }),
    );
    const answer = accumulateFlakiness({
      subject: SUBJECT,
      runs,
      occurrences: [
        occurrence({ run: 'a', at: '2026-03-01T00:00:00.000Z', component: 'Rare', band: 'geometry' }),
        occurrence({ run: 'a', at: '2026-03-01T00:00:00.000Z' }),
        occurrence({ run: 'b', at: '2026-03-02T00:00:00.000Z' }),
        occurrence({ run: 'c', at: '2026-03-03T00:00:00.000Z' }),
      ],
    });

    expect(answer.causes[0]).toEqual({ component: 'Clock', band: 'content', runs: 3 });
  });

  it('drops an occurrence whose run the window excluded rather than counting it', () => {
    // A limit can cut the runs and the occurrences apart. An occurrence with no
    // run behind it is a numerator without a denominator, which is a rate above
    // its true value in the alarming direction.
    const answer = accumulateFlakiness({
      subject: SUBJECT,
      runs: [run({ run: 'a', swept: true })],
      occurrences: [occurrence({ run: 'a' }), occurrence({ run: 'stranded' })],
      omittedOccurrences: 1,
    });

    expect(answer.occurrences).toBe(1);
    expect(answer.omittedOccurrences).toBe(1);
  });

  it('says silence is silence when no sweep has ever run', () => {
    const answer = accumulateFlakiness({ subject: SUBJECT, runs: [run()], occurrences: [] });

    expect(describeFlakiness(answer)).toContain('this is silence, not stability');
  });

  it('refuses rows belonging to another subject', () => {
    expect(() =>
      accumulateFlakiness({
        subject: SUBJECT,
        runs: [run()],
        occurrences: [occurrence({ subject: 'story:other' })],
      }),
    ).toThrow(/mixed slice invents a flake/);
  });
});
