import { describe, expect, it } from 'vitest';
import { changelogOf, isRecorded } from './changelog.js';
import { parseCommitMessage, renderCommitMessage } from './changelog-message.js';
import type { ObservationRecord, RegionRecord, RunReport } from './format.js';

/**
 * What a baseline update says about itself, a month later.
 *
 * The properties asserted here are the ones that decide whether the record can be
 * trusted rather than merely read: that it describes only what was accepted, that
 * it never invents a build to attribute a baseline to, that a shape refused in
 * half its subjects is not recorded as though it landed everywhere, and that the
 * trip through a commit message returns what went in — including through a squash
 * merge, which is where a naive trailer reader silently returns nothing.
 */

const BRAND = 'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FIRST = '2026-05-02T00:00:00.000Z';
const LAST = '2026-08-10T00:00:00.000Z';
const SPACING = 'v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function region(overrides: Partial<RegionRecord> = {}): RegionRecord {
  return { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, ...overrides };
}

function changed(subject: string, regions: readonly RegionRecord[]): ObservationRecord {
  return { subject, verdict: 'changed', because: 'moved', changedPixels: 100, regions };
}

/** Everything between the subject line and the first trailer. */
function prose(message: string): readonly string[] {
  const lines = message.split('\n').slice(2);
  const trailer = lines.findIndex((line) => line.startsWith('Variance-'));
  return lines.slice(0, trailer === -1 ? undefined : trailer - 1);
}

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runVersion: 1,
    at: '2026-08-20T00:00:00.000Z',
    identity: { engine: 'chromium', engineVersion: '1', platform: 'linux', digest: 'd' },
    retention: 'durable',
    run: { id: '4242', commit: 'abc123' },
    observations: [],
    ...overrides,
  };
}

describe('a record of one baseline update', () => {
  it('describes the subjects that were accepted, not the ones the shape reached', () => {
    const record = changelogOf({
      report: report({
        observations: [
          changed('story:a', [region({ fingerprint: BRAND, component: 'Button', file: 'src/Button.tsx' })]),
          changed('story:b', [region({ fingerprint: BRAND, component: 'Button' })]),
          changed('story:c', [region({ fingerprint: BRAND, component: 'Button' }), region({ fingerprint: SPACING })]),
        ],
      }),
      accepted: ['story:a', 'story:b'],
      selection: 'shape',
      at: '2026-08-21T00:00:00.000Z',
    });

    expect(isRecorded(record)).toBe(true);
    if (!isRecorded(record)) return;

    expect(record.entries).toHaveLength(1);
    expect(record.entries[0]).toMatchObject({
      fingerprint: BRAND,
      component: 'Button',
      file: 'src/Button.tsx',
      subjects: ['story:a', 'story:b'],
    });
    // Not carried, and the absence is the decision: a changed-pixel count
    // measures displacement rather than magnitude and is bound to the machine
    // that produced it. In a record that outlives its report, it is a number two
    // readers would compare and one of them would be wrong.
    expect(record.entries[0]).not.toHaveProperty('pixels');
    // The part this update did not take. Dropping it would read as the whole
    // shape having been promoted.
    expect(record.entries[0]?.reached).toBe(3);
    // Nothing carries the accepted total, because the entries and `ungrouped`
    // already do. Two numbers that can disagree leave a reader deciding which
    // one is the record.
    expect(record).not.toHaveProperty('subjects');
  });

  it('counts accepted subjects no shape could group rather than inventing one for them', () => {
    const record = changelogOf({
      report: report({
        observations: [changed('story:a', [region()]), changed('story:b', [region({ fingerprint: BRAND })])],
      }),
      accepted: ['story:a', 'story:b'],
      selection: 'all',
      at: '2026-08-21T00:00:00.000Z',
    });

    if (!isRecorded(record)) throw new Error(record.because);
    expect(record.ungrouped).toBe(1);
    expect(record.entries).toHaveLength(1);
  });

  it('refuses a report that cannot name its run, rather than attributing a baseline to nothing', () => {
    const record = changelogOf({
      report: report({ run: undefined, observations: [changed('story:a', [region()])] }),
      accepted: ['story:a'],
      selection: 'named',
      at: '2026-08-21T00:00:00.000Z',
    });

    expect(isRecorded(record)).toBe(false);
    expect((record as { because: string }).because).toContain('which run produced it');
  });

  it('refuses when nothing was accepted, because there is no update to explain', () => {
    const record = changelogOf({
      report: report({ observations: [changed('story:a', [region()])] }),
      accepted: [],
      selection: 'named',
      at: '2026-08-21T00:00:00.000Z',
    });

    expect(isRecorded(record)).toBe(false);
    expect((record as { because: string }).because).toContain('nothing was accepted');
  });
});

describe('an entry formed by something other than region clustering', () => {
  // A change to an interface is the same kind of fact this record carries and has
  // no rectangle. The alternative was a producer fabricating `x`, `y`, `width`
  // and `height` to get through the region path — four invented numbers in the
  // one artifact nobody can go back and correct.
  const CONTRACT = 'v1:cccccccccccccccccccccccccccccccc';

  const formed = {
    fingerprint: CONTRACT,
    component: 'PaymentIntent',
    file: 'openapi.yaml:412',
    subjects: ['GET /payments', 'POST /payments'],
    reached: 9,
    cause: true,
  } as const;

  it('appends it after the clustered ones, in the order it was given', () => {
    const record = changelogOf({
      report: report({
        observations: [changed('story:a', [region({ fingerprint: BRAND, component: 'Button' })])],
      }),
      accepted: ['story:a'],
      selection: 'all',
      at: '2026-08-21T00:00:00.000Z',
      entries: [formed],
    });

    if (!isRecorded(record)) throw new Error(record.because);
    expect(record.entries.map((entry) => entry.fingerprint)).toEqual([BRAND, CONTRACT]);
    // Untouched. It counts accepted subjects *this report's regions* could not
    // group, and a producer that never looked at a region has nothing to say
    // about it.
    expect(record.ungrouped).toBe(0);
  });

  it('refuses one that could not be acted on, rather than writing it', () => {
    // `accept --shape` takes this string as an argument and a commit message is
    // the one artifact nobody can go back and correct, so the check is on the
    // writing machine rather than on every reader afterwards.
    const record = changelogOf({
      report: report({
        observations: [changed('story:a', [region({ fingerprint: BRAND })])],
      }),
      accepted: ['story:a'],
      selection: 'all',
      at: '2026-08-21T00:00:00.000Z',
      entries: [{ ...formed, reached: 1 }],
    });

    expect(isRecorded(record)).toBe(false);
    expect((record as { because: string }).because).toContain(CONTRACT);
  });
});

describe('the commit message is the store', () => {
  const record = changelogOf({
    report: report({
      intent: 'tighten the card',
      drift: {
        '--va-space-3': {
          from: '12px',
          to: '20px',
          steps: 11,
          firstAt: '2026-05-02T00:00:00.000Z',
          lastAt: '2026-08-10T00:00:00.000Z',
          because: '`--va-space-3` drifted 12px → 20px, 8px across 11 approved commit(s)',
        },
      },
      observations: [
        changed('story:a', [region({ fingerprint: BRAND, component: 'Card: small', file: 'src/Card.tsx' })]),
      ],
    }),
    accepted: ['story:a'],
    selection: 'all',
    at: '2026-08-21T00:00:00.000Z',
    project: 'design-system',
  });

  it('round-trips a record through a message a reviewer can also read', () => {
    if (!isRecorded(record)) throw new Error(record.because);
    const message = renderCommitMessage({ message: 'chore(variance): regenerate baselines', record });

    expect(message.split('\n')[0]).toBe('chore(variance): regenerate baselines');

    // Asserted whole rather than by `toContain`, because the cost of this format
    // is what a reader scrolling `git log` pays for every baseline update, and
    // that cost is only visible when the block is written out. A line added here
    // is a line added to every commit the action will ever write.
    //
    // Each change line leads with the fingerprint `accept --shape` takes, so it
    // is a string to copy rather than a sentence to interpret, and the drift line
    // states the numbers rather than the report's rendering of them — a sentence
    // frozen into a commit is a sentence that can never be reworded.
    expect(prose(message)).toEqual([
      'tighten the card',
      '',
      `${BRAND} Card: small src/Card.tsx 1`,
      'drift --va-space-3 12px -> 20px over 11 approvals',
      '',
      'run 4242 @ abc123 --all',
    ]);

    expect(parseCommitMessage(message)).toEqual(record);
  });

  it('orders drift by bytes, so two machines write the same commit', () => {
    // `localeCompare` is the right sort for a list shown to a person and the
    // wrong one for a list serialised into a commit: it orders by the machine's
    // `LANG`, so two runners accepting the same run would write different bytes
    // for the same facts. That is the machine-boundness this record refuses
    // everywhere else, arriving through the back door of a sort.
    const many = changelogOf({
      report: report({
        drift: Object.fromEntries(
          ['--va-Z', '--va-a', '--va-B'].map((token) => [
            token,
            { from: '1px', to: '2px', steps: 2, firstAt: FIRST, lastAt: LAST, because: '' },
          ]),
        ),
        observations: [changed('story:a', [region({ fingerprint: BRAND })])],
      }),
      accepted: ['story:a'],
      selection: 'all',
      at: '2026-08-21T00:00:00.000Z',
    });

    if (!isRecorded(many)) throw new Error(many.because);
    expect(many.drift?.map((drift) => drift.token)).toEqual(['--va-B', '--va-Z', '--va-a']);
  });

  it('keeps a field it does not know, so a newer writer does not lose it here', () => {
    // The forward-compatibility rule, asserted rather than documented: a reader
    // that dropped unknown keys would silently rewrite history the moment two
    // versions of this tool shared a repository, and the losing side would be
    // whichever one happened to run `variance changelog` last.
    //
    // The version is bumped only when an existing field changes meaning. Adding
    // one does not need it, which is only true if this passes.
    if (!isRecorded(record)) throw new Error(record.because);
    const later = {
      ...record,
      weather: 'rain',
      entries: record.entries.map((entry) => ({ ...entry, weather: 'rain' })),
    } as unknown as typeof record;

    const parsed = parseCommitMessage(
      renderCommitMessage({ message: 'chore(variance): regenerate baselines', record: later }),
    );

    expect(parsed).toEqual(later);
  });

  it('survives a squash merge, where the trailers stop being the last paragraph', () => {
    if (!isRecorded(record)) throw new Error(record.because);
    const message = renderCommitMessage({ message: 'chore(variance): regenerate baselines', record });

    const squashed = `Update the card (#412)\n\n* ${message}\n* fix a test\n\nReviewed-by: somebody\n`;
    expect(parseCommitMessage(squashed)).toEqual(record);
  });

  it('is absent from an ordinary commit, which is not a failure', () => {
    expect(parseCommitMessage('fix the button\n\nSigned-off-by: somebody\n')).toBeUndefined();
  });

  it('refuses an encoding it does not know rather than reading the half it recognises', () => {
    expect(() => parseCommitMessage('chore\n\nVariance-Run: v9 e30\n')).toThrow(/understands v1/);
  });

  it('refuses two heads in one message', () => {
    if (!isRecorded(record)) throw new Error(record.because);
    const message = renderCommitMessage({ message: 'chore', record });
    const head = message.split('\n').find((line) => line.startsWith('Variance-Run:'))!;

    expect(() => parseCommitMessage(`${message}\n${head}\n`)).toThrow(/one run/);
  });
});
