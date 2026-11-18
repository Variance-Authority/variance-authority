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

/** Base64 VLQ mappings for `lines`, each segment `[generated column, original line, original column]` in source 0. */
function mappings(lines: readonly (readonly (readonly [number, number, number])[])[]): string {
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const vlq = (value: number): string => {
    let rest = value < 0 ? (-value << 1) | 1 : value << 1;
    let out = '';
    do {
      const digit = rest & 31;
      rest >>>= 5;
      out += digits[rest > 0 ? digit | 32 : digit];
    } while (rest > 0);
    return out;
  };
  let line = 0;
  let column = 0;
  return lines.map((segments) => {
    let generated = 0;
    return segments.map(([at, toLine, toColumn]) => {
      const out = vlq(at - generated) + vlq(0) + vlq(toLine - line) + vlq(toColumn - column);
      [generated, line, column] = [at, toLine, toColumn];
      return out;
    }).join(',');
  }).join(';');
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

  it('reads each function of a script with no map by the innermost range around its start', () => {
    const functions = [
      { functionName: '', ranges: [{ startOffset: 0, endOffset: MATH.length, count: 1 }], isBlockCoverage: true },
      { functionName: 'twice', ranges: [{ startOffset: MATH.indexOf('(x: number) =>'), endOffset: MATH.length - 1, count: 0 }], isBlockCoverage: false },
      { functionName: 'add', ranges: [{ startOffset: MATH.indexOf('function add'), endOffset: MATH.indexOf('\n\nexport function never'), count: 2 }], isBlockCoverage: false },
      { functionName: 'never', ranges: [{ startOffset: MATH.indexOf('function never'), endOffset: MATH.indexOf('\n\nexport const'), count: 0 }], isBlockCoverage: false },
    ];
    const read = sessionSources([{ file: '/repo/src/math.ts', text: MATH, functions }], 'presence');

    expect(states(read.sources, '/repo/src/math.ts')).toEqual({ add: 'ran', never: 'unrun', twice: 'unrun' });
  });

  it('reads nothing from a segment on generated whitespace, which carries the origin of the code before it', () => {
    const text = 'export class Box {\n  get a() { return 1; }\n  get b() { return 2; }\n}\n';
    // esbuild opens the second getter's line with its indentation mapped to the first getter's closing brace.
    const map = { version: 3, sources: ['box.ts'], sourcesContent: [text], names: [], mappings: mappings([
      [[0, 0, 0]],
      [[2, 1, 2], [12, 1, 12]],
      [[0, 1, 22], [2, 2, 2], [12, 2, 12]],
      [[0, 3, 0]],
    ]) };
    const getter = (name: string, count: number) => {
      const start = text.indexOf(`get ${name}`);
      return { functionName: `get ${name}`, ranges: [{ startOffset: start, endOffset: text.indexOf('}', start) + 1, count }], isBlockCoverage: false };
    };
    const functions = [
      { functionName: '', ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }], isBlockCoverage: true },
      getter('a', 0),
      getter('b', 1),
    ];
    const read = sessionSources([{ file: '/repo/dist/box.js', text, map, functions }], 'presence');

    expect(states(read.sources, '/repo/dist/box.ts')).toEqual({ 'Box/a': 'unrun', 'Box/b': 'ran' });
  });

  it('reads nothing of a source the map leaves unnamed, and places the rest', () => {
    const read = sessionSources(
      [{ file: '/repo/dist/main.js', text: BUNDLE, map: { ...BUNDLE_MAP, sources: [null, '../src/main.ts'] }, functions: BUNDLE_FUNCTIONS }],
      'presence',
    );

    expect(read.unplaced).toEqual([]);
    expect(read.sources.map((each) => each.file)).toEqual(['/repo/src/main.ts']);
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

  it('tells apart two functions whose kind, name, path and text agree, by their order in the file', () => {
    const text = 'register({ render() { return 1; } });\nregister({ render() { return 1; } });\n';
    const cut = sourceCut(text, 'src/render.ts', 'presence')!;
    const own = cut.rows.filter((row) => row.kind === 'function');
    const source = (states: readonly ('ran' | 'unrun')[], from = text) => {
      const its = sourceCut(from, 'src/render.ts', 'presence')!;
      const rows = its.rows.filter((row) => row.kind === 'function');
      return { file: 'src/render.ts', text: from, sourceDigest: its.sourceDigest, functions: rows.map((row, index) => ({ row, state: states[index]! })) };
    };
    const record = {
      file: 'src/render.ts',
      sourceDigest: cut.sourceDigest,
      instrumented: true,
      blocks: cut.rows.map((row) => ({ ...row, testFiles: row === own[0] ? ['src/render.test.ts'] : [] })),
    };
    const three = `${text}register({ render() { return 1; } });\n`;
    const answer = sessionsAgainst(
      [{ name: 'checkout', sources: [source(['ran', 'unrun'])] }, { name: 'older', sources: [source(['unrun', 'unrun', 'ran'], three)] }],
      [[record]],
      () => text,
      'presence',
    );

    expect(own.length).toBe(2);
    expect(answer.files[0]!.functions.map(({ row, sessions, testFiles }) => ({ line: row.startLine, sessions, testFiles }))).toEqual([
      { line: 1, sessions: ['ran', 'unknown'], testFiles: ['src/render.test.ts'] },
      { line: 2, sessions: ['unrun', 'unknown'], testFiles: [] },
    ]);
  });

  it('says no case can be counted for a function a record holds in another text', () => {
    const session = named('checkout', sessionSources([bundle], 'presence'));
    const answer = sessionsAgainst([session], [[recorded(MATH.replace('a + b', 'a - b'))]], (file) => disk.get(file), 'presence');

    const add = answer.files.find((file) => file.file === 'src/math.ts')!.functions.find((each) => each.name === 'add')!;
    expect(add.sessions).toEqual(['ran']);
    expect(add.testFiles).toBeUndefined();
  });

  it('counts no case for a function one suite ran by no case while another loaded its file unprobed', () => {
    const session = named('checkout', sessionSources([bundle], 'presence'));
    const unprobed = { file: 'src/math.ts', sourceDigest: 'x', instrumented: false, blocks: [] };
    const answer = sessionsAgainst([session], [[recorded(MATH)], [unprobed]], (file) => disk.get(file), 'presence');

    const math = answer.files.find((file) => file.file === 'src/math.ts')!;
    expect(math.functions.map(({ name, testFiles }) => ({ name, testFiles }))).toEqual([
      { name: 'add', testFiles: ['src/math.test.ts'] },
      { name: 'never', testFiles: undefined },
      { name: 'twice', testFiles: undefined },
    ]);
  });

  it('counts no case for a function one suite ran by no case while another holds it in another text', () => {
    const session = named('checkout', sessionSources([bundle], 'presence'));
    const stale = recorded(MATH.replace('x * 2;', 'x * 2 + 0;'));
    const answer = sessionsAgainst([session], [[recorded(MATH)], [stale]], (file) => disk.get(file), 'presence');

    const math = answer.files.find((file) => file.file === 'src/math.ts')!;
    expect(math.functions.map(({ name, testFiles }) => ({ name, testFiles }))).toEqual([
      { name: 'add', testFiles: ['src/math.test.ts'] },
      { name: 'never', testFiles: [] },
      { name: 'twice', testFiles: undefined },
    ]);
  });

  it('names a function a session ran that the checkout no longer holds, with the sessions that ran it', () => {
    const session = named('checkout', sessionSources([bundle], 'presence'));
    const renamed = new Map([...disk, ['src/math.ts', MATH.replace('twice', 'thrice')]]);
    const answer = sessionsAgainst([session, { name: 'idle', sources: [] }], [[recorded(MATH)]], (file) => renamed.get(file), 'presence');

    const math = answer.files.find((file) => file.file === 'src/math.ts')!;
    expect(math.gone).toEqual([{ name: 'twice', sessions: ['checkout'] }]);
    expect(answer.files.find((file) => file.file === 'src/main.ts')!.gone).toEqual([]);
  });

  it('counts no case for a function in a file the record loaded but did not probe, and none ran for one it never loaded', () => {
    const session = named('checkout', sessionSources([bundle], 'presence'));
    const unprobed = { file: 'src/main.ts', sourceDigest: 'x', instrumented: false, blocks: [] };
    const answer = sessionsAgainst([session], [[recorded(MATH), unprobed]], (file) => disk.get(file), 'presence');
    const testFiles = (file: string) => answer.files.find((each) => each.file === file)!.functions.map((each) => each.testFiles);

    expect(testFiles('src/main.ts').every((each) => each === undefined)).toBe(true);
    expect(sessionsAgainst([session], [[recorded(MATH)]], (file) => disk.get(file), 'presence').files.find((each) => each.file === 'src/main.ts')!.functions.map((each) => each.testFiles)).toEqual(testFiles('src/main.ts').map(() => []));
  });
});
