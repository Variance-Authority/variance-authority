import { describe, expect, it } from 'vitest';
import type { ExecutionNarrowing, FileReading } from '@variance-authority/sense/test-selection';
import type { Collected, Plan } from './run.js';
import { collectorOf, configOf, documentFor, runWith, storeAnswering, whiteBaselineOf } from './run-fixture.js';
import { formatSelection, selectionNotes, skippableTests } from './select.js';

/**
 * `variance run --since` and `variance select` both read the change through
 * the journal, and both print what the parser made of each changed file: the
 * verdict, why a file was not read, and a test that loaded it through an import
 * the file graph does not list. The readings are the journal's, printed as they
 * came.
 */

const READINGS: readonly FileReading[] = [
  { file: 'src/Button.tsx', verdict: 'values', names: ['SIZE'], unseen: ['fixture:b'] },
  { file: 'src/Clock.tsx', unread: 'hunk' },
];

const PRINTED = [
  'read src/Button.tsx: values — SIZE changed; their readers and the changed regions are charged',
  'unseen fixture:b: loaded src/Button.tsx through an import the file graph does not list; named, not selected',
  'read src/Clock.tsx: unread — the diff does not apply to the recorded text, so its changed lines are charged',
];

describe('`variance run --since` prints how it read each changed file', () => {
  const plan: Plan = {
    subjects: [
      { subject: { id: 'fixture:a', kind: 'fixture' } },
      { subject: { id: 'fixture:b', kind: 'fixture' } },
    ],
    notObserved: [],
    warnings: [],
  };
  const collector = collectorOf(plan, (subject): Collected => ({ ok: true, document: documentFor(subject.subject.id) }));
  const baseline = whiteBaselineOf(documentFor('fixture:a'));
  const store = storeAnswering({
    ...baseline,
    raster: { ...baseline.raster, components: [{ component: 'Button', instances: 1, structure: 'v1:s' }] },
  });
  const diff = ['--- a/src/Button.tsx', '+++ b/src/Button.tsx', '@@ -9,1 +9,1 @@'].join('\n');

  it('adds one line per reading, and one per unseen test, to the run notes', async () => {
    const { report } = await runWith(configOf({ source: { dirs: ['src'] } }), collector, store, {
      since: { ref: 'origin/main', changed: ['src/Button.tsx', 'src/Clock.tsx'], diff },
      scanSource: async () => ({ Button: [{ file: 'src/Button.tsx', line: 1, via: 'function' }] }),
      readJourney: async () => ({
        whole: ['fixture:a', 'fixture:b'],
        entered: ['fixture:a'],
        unread: [],
        stale: [],
        because: [],
        readings: READINGS,
      }),
    });

    expect(report.warnings?.slice(-PRINTED.length)).toEqual(PRINTED);
  });
});

describe('`variance select` prints how it read each changed file', () => {
  const narrowing: ExecutionNarrowing = {
    whole: ['test/a.test.ts', 'test/b.test.ts'],
    entered: ['test/a.test.ts'],
    unread: [],
    stale: [],
    because: [],
    readings: READINGS,
  };
  const selection = skippableTests({ at: '/cache/coverage.bin', commit: 'c0ffee', ground: { kind: 'read', narrowing } });

  it('prints the readings on stderr, after the answer', () => {
    expect(selectionNotes(selection).trimEnd().split('\n').slice(1)).toEqual(PRINTED);
  });

  it('keeps them off stdout, and gives them to `--format json` as data', () => {
    expect(formatSelection(selection, 'plain', '/repo')).toBe('test/b.test.ts\n');
    expect(JSON.parse(formatSelection(selection, 'json', '/repo')).readings).toEqual(READINGS);
  });

  it('prints no reading and no `readings` field when no diff was read', () => {
    const unread = skippableTests({ at: '/cache/coverage.bin', ground: { kind: 'no-journal' } });
    expect(selectionNotes(unread)).not.toContain('read ');
    expect(JSON.parse(formatSelection(unread, 'json', '/repo'))).not.toHaveProperty('readings');
  });
});
