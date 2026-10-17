import { describe, expect, it } from 'vitest';
import type { ExecutionNarrowing, SelectionReason } from '@variance-authority/sense/test-selection';
import { formatSelection, skippableTests, type SelectGround } from './select.js';

/**
 * `variance select --format json`, read by a program deciding what to run.
 *
 * The skip list says what may be left out. A reader holding it also needs why
 * each test stayed in, and why the whole suite did when it did, without
 * parsing the sentences written for a person.
 */

const WHOLE = ['test/alpha.test.ts', 'test/beta.test.ts', 'test/gamma.test.ts', 'test/delta.test.ts'];

const PAD: SelectionReason = { kind: 'region', file: 'src/pad.ts', name: 'pad', path: 'pad', startLine: 1, endLine: 3 };
const TRAIL: SelectionReason = { kind: 'importer', trail: ['src/pad.css', 'src/pad.ts'] };

function json(ground: SelectGround): Record<string, unknown> {
  return JSON.parse(formatSelection(skippableTests({ at: '/cache/coverage.bin', commit: 'c0ffee', ground }), 'json', '/repo')) as Record<
    string,
    unknown
  >;
}

function read(over: Partial<ExecutionNarrowing>): SelectGround {
  return { kind: 'read', narrowing: { whole: WHOLE, entered: [], unread: [], stale: [], because: [], ...over } };
}

describe('why `--format json` selected each test', () => {
  it('names each reason once and has every selected test point at its own', () => {
    const said = json(
      read({
        entered: ['test/beta.test.ts', 'test/gamma.test.ts'],
        because: [
          { test: 'test/beta.test.ts', via: [PAD] },
          { test: 'test/gamma.test.ts', via: [{ ...PAD }, TRAIL] },
        ],
      }),
    );

    expect(said['ground']).toBe('read');
    expect(said['reasons']).toEqual([PAD, TRAIL]);
    expect(said['selected']).toEqual([
      { test: 'test/beta.test.ts', reasons: [0] },
      { test: 'test/gamma.test.ts', reasons: [0, 1] },
    ]);
    expect(said['skip']).toEqual(['test/alpha.test.ts', 'test/delta.test.ts']);
  });

  it('names the recorded tests whose observation was not whole, which run whatever changed', () => {
    const said = json(read({ incomplete: ['test/epsilon.test.ts'] }));

    expect(said['incomplete']).toEqual(['test/epsilon.test.ts']);
    expect(said['selected']).toEqual([]);
    expect(said['reasons']).toEqual([]);
  });

  // A leg leaves in `skip` tests the change reached; it does not run them.
  it('names in no other list a test the selection skips', () => {
    const selection = skippableTests({
      at: '/cache/coverage.bin',
      ground: read({
        entered: ['test/beta.test.ts', 'test/gamma.test.ts'],
        incomplete: ['test/epsilon.test.ts'],
        because: [
          { test: 'test/beta.test.ts', via: [PAD] },
          { test: 'test/gamma.test.ts', via: [TRAIL] },
        ],
      }),
    });
    const left = { ...selection, skip: [...selection.skip, 'test/gamma.test.ts', 'test/epsilon.test.ts'] };
    const said = JSON.parse(formatSelection(left, 'json', '/repo')) as Record<string, unknown>;

    expect(said['selected']).toEqual([{ test: 'test/beta.test.ts', reasons: [0] }]);
    expect(said['reasons']).toEqual([PAD]);
    expect(said['incomplete']).toEqual([]);
  });

  it('names the stage that kept the whole suite, and the files that moved what it rests on', () => {
    const said = json({ kind: 'before', whole: 'the suite unit rests on test/setup.ts', rests: ['test/setup.ts'] });

    expect(said).toMatchObject({ ground: 'before', rests: ['test/setup.ts'], skip: [] });
    expect(said).not.toHaveProperty('selected');
    expect(said).not.toHaveProperty('reasons');
  });

  it('says which reading could not be made when there is no record to select from', () => {
    const said = json({ kind: 'no-journal' });

    expect(said).toMatchObject({ ground: 'no-journal', skip: [], widened: 'no execution journal at /cache/coverage.bin' });
    expect(said).not.toHaveProperty('selected');
  });
});
