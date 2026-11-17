import { describe, expect, it } from 'vitest';
import { BUNDLE, BUNDLE_FUNCTIONS, BUNDLE_MAP, MAIN, MATH } from './__fixtures__/session.js';
import { sourceCut } from './coverage-rows.js';
import type { CoverageModule } from './index.js';
import { sessionSources, sessionsAgainst, type NamedSession, type SessionRead, type SessionSource } from './session.js';

/** Each function of `file` by its region's name, with what the session says of it. */
function states(sources: readonly SessionSource[], file: string): Record<string, string> {
  const source = sources.find((each) => each.file === file);
  return Object.fromEntries((source?.functions ?? []).map((each) => [each.row.name, each.state]));
}

describe('a session read into the record\'s regions', () => {
  it('names each function of a bundled source by its region, as ran, loaded but not run, or unknown', () => {
    const read = sessionSources(
      [{ file: '/repo/dist/main.js', text: BUNDLE, map: BUNDLE_MAP, functions: BUNDLE_FUNCTIONS }],
      'presence',
    );

    expect(read.unplaced).toEqual([]);
    expect(states(read.sources, '/repo/src/math.ts')).toEqual({ add: 'ran', never: 'unknown', twice: 'ran' });
    expect(states(read.sources, '/repo/src/main.ts')).toEqual({ unused: 'unrun' });
    expect(read.sources.find((each) => each.file === '/repo/src/math.ts')?.text).toBe(MATH);
  });

  it('reads a script with no map as its own source', () => {
    const functions = [
      { functionName: '', ranges: [{ startOffset: 0, endOffset: MAIN.length, count: 1 }], isBlockCoverage: true },
      { functionName: 'unused', ranges: [{ startOffset: MAIN.indexOf('function unused'), endOffset: MAIN.indexOf('\n\nconsole'), count: 0 }], isBlockCoverage: false },
    ];
    const read = sessionSources([{ file: '/repo/src/main.ts', text: MAIN, functions }], 'presence');

    expect(states(read.sources, '/repo/src/main.ts')).toEqual({ unused: 'unrun' });
  });

  it('names a source the map places nowhere on this machine, and reads nothing of it', () => {
    const read = sessionSources(
      [{ file: '/repo/dist/main.js', text: BUNDLE, map: { ...BUNDLE_MAP, sources: ['webpack://app/src/math.ts', '../src/main.ts'] }, functions: BUNDLE_FUNCTIONS }],
      'presence',
    );

    expect(read.unplaced).toEqual(['webpack://app/src/math.ts']);
    expect(read.sources.map((each) => each.file)).toEqual(['/repo/src/main.ts']);
  });

  it('names a source the map holds no text of when nothing reads it from disk', () => {
    const { sourcesContent: _, ...bare } = BUNDLE_MAP;
    const read = sessionSources([{ file: '/repo/dist/main.js', text: BUNDLE, map: bare, functions: BUNDLE_FUNCTIONS }], 'presence');

    expect(read.unplaced).toEqual(['../src/main.ts', '../src/math.ts']);
    expect(read.sources).toEqual([]);
  });
});

describe('sessions set beside the record', () => {
  const bundle = { file: '/repo/dist/main.js', text: BUNDLE, map: BUNDLE_MAP, functions: BUNDLE_FUNCTIONS };
  /** `sources` with each file relative to `/repo`, as a record spells it. */
  function named(name: string, read: SessionRead): NamedSession {
    return { name, sources: read.sources.map((source) => ({ ...source, file: source.file.slice('/repo/'.length) })) };
  }
  /** The record of a suite that ran `add` from `math.test.ts` and loaded nothing else. */
  function recorded(text: string): CoverageModule {
    const cut = sourceCut(text, 'src/math.ts', 'presence')!;
    return {
      file: 'src/math.ts',
      sourceDigest: cut.sourceDigest,
      instrumented: true,
      blocks: cut.rows.map((row) => ({ ...row, testFiles: row.name === 'add' ? ['src/math.test.ts'] : [] })),
    };
  }
  const disk = new Map([['src/math.ts', MATH], ['src/main.ts', MAIN], ['src/other.ts', 'export const x = 1;\n']]);

  it('names, per function, which sessions ran it and which test files did', () => {
    const one = named('checkout', sessionSources([bundle], 'presence'));
    const unrun = BUNDLE_FUNCTIONS.map((each) => each.functionName === 'twice' ? { ...each, ranges: [{ ...each.ranges[0]!, count: 0 }] } : each);
    const two = named('refund', sessionSources([{ ...bundle, functions: unrun }], 'presence'));
    const answer = sessionsAgainst([one, two], [[recorded(MATH)]], (file) => disk.get(file), 'presence');

    const math = answer.files.find((file) => file.file === 'src/math.ts')!;
    expect(math.functions.map(({ name, sessions, testFiles }) => ({ name, sessions, testFiles }))).toEqual([
      { name: 'add', sessions: ['ran', 'ran'], testFiles: ['src/math.test.ts'] },
      { name: 'never', sessions: ['unknown', 'unknown'], testFiles: [] },
      { name: 'twice', sessions: ['ran', 'unrun'], testFiles: [] },
    ]);
    const main = answer.files.find((file) => file.file === 'src/main.ts')!;
    expect(main.functions.map(({ name, sessions, testFiles }) => ({ name, sessions, testFiles }))).toEqual([
      { name: 'unused', sessions: ['unrun', 'unrun'], testFiles: [] },
    ]);
  });

  it('says a session that loaded none of a file did not load it, beside one that did', () => {
    const one = named('checkout', sessionSources([bundle], 'presence'));
    const answer = sessionsAgainst([one, { name: 'idle', sources: [] }], [[recorded(MATH)]], (file) => disk.get(file), 'presence');

    const math = answer.files.find((file) => file.file === 'src/math.ts')!;
    expect(math.functions.map(({ name, sessions }) => ({ name, sessions }))).toEqual([
      { name: 'add', sessions: ['ran', 'not loaded'] },
      { name: 'never', sessions: ['unknown', 'not loaded'] },
      { name: 'twice', sessions: ['ran', 'not loaded'] },
    ]);
  });

  it('reads a function whose text differs from the checkout\'s as another text, and the file no session loaded as not loaded', () => {
    const edited = MATH.replace('a + b', 'a + b + 0');
    const session = named('checkout', sessionSources([{ ...bundle, map: { ...BUNDLE_MAP, sourcesContent: [edited, MAIN] } }], 'presence'));
    const other = { file: 'src/other.ts', sourceDigest: 'x', instrumented: true, blocks: [] };
    const answer = sessionsAgainst([session], [[recorded(MATH), other]], (file) => disk.get(file), 'presence');

    const math = answer.files.find((file) => file.file === 'src/math.ts')!;
    expect(math.functions.map(({ name, sessions }) => ({ name, sessions }))).toEqual([
      { name: 'add', sessions: ['other text'] },
      { name: 'never', sessions: ['unknown'] },
      { name: 'twice', sessions: ['ran'] },
    ]);
    expect(answer.notLoaded).toEqual(['src/other.ts']);
  });

  it('tells apart two functions that share a name, each by its own text', () => {
    const text = 'export function split(xs: number[]) {\n  const a = xs.filter((x) => x > 0);\n  const b = xs.filter((x) => x < 0 && x !== -1);\n  return [a, b];\n}\n';
    const cut = sourceCut(text, 'src/split.ts', 'presence')!;
    const first = cut.rows.find((row) => row.name === 'split/filter.arg0')!;
    const session = {
      name: 'checkout',
      sources: [{ file: 'src/split.ts', text, sourceDigest: cut.sourceDigest, functions: cut.rows.filter((row) => row.kind === 'function').map((row) => ({ row, state: 'ran' as const })) }],
    };
    const record = {
      file: 'src/split.ts',
      sourceDigest: cut.sourceDigest,
      instrumented: true,
      blocks: cut.rows.map((row) => ({ ...row, testFiles: row === first ? ['src/split.test.ts'] : [] })),
    };
    const answer = sessionsAgainst([session], [[record]], () => text, 'presence');

    expect(answer.files[0]!.functions.map(({ name, row, testFiles }) => ({ name, line: row.startLine, testFiles }))).toEqual([
      { name: 'split', line: 1, testFiles: [] },
      { name: 'split/filter.arg0', line: 2, testFiles: ['src/split.test.ts'] },
      { name: 'split/filter.arg0', line: 3, testFiles: [] },
    ]);
  });

  it('says no case can be counted for a function a record holds in another text', () => {
    const session = named('checkout', sessionSources([bundle], 'presence'));
    const answer = sessionsAgainst([session], [[recorded(MATH.replace('a + b', 'a - b'))]], (file) => disk.get(file), 'presence');

    const add = answer.files.find((file) => file.file === 'src/math.ts')!.functions.find((each) => each.name === 'add')!;
    expect(add.sessions).toEqual(['ran']);
    expect(add.testFiles).toBeUndefined();
  });
});
