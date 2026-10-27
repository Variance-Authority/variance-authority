import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, clones, clonesIn, paired } from './clones.mjs';

/**
 * Pasted code, held where it is.
 *
 * A second implementation is a defect (`AGENTS.md`). When the second one was
 * made by pasting the first, its tokens still match. This holds the count of
 * pasted blocks per pair of files. A new pair, or more clones between a known
 * pair, fails. A pair that was folded back into one implementation fails too,
 * until the baseline is tightened.
 *
 * ```bash
 * yarn clones --write
 * ```
 *
 * A re-typed copy does not match token for token, and `owners.check.ts` covers
 * the short idioms that are re-typed most often. A long flow re-typed with new
 * names is caught by neither, and only a reviewer comparing the two flows step
 * by step finds it.
 */

interface Clone {
  readonly a: { readonly at: string; readonly lines: readonly [number, number] };
  readonly b: { readonly at: string; readonly lines: readonly [number, number] };
}

interface Pair {
  readonly files: readonly [string, string];
  readonly count: number;
}

const BLOCK = [
  'export async function settle(paths: readonly string[], read: (path: string) => Promise<string>) {',
  '  const seen = new Map<string, number>();',
  '  for (const path of paths) {',
  '    const text = await read(path);',
  '    const count = seen.get(text) ?? 0;',
  '    seen.set(text, count + 1);',
  '    if (count > 2) throw new Error(`${path} repeats ${text.length} characters`);',
  '  }',
  '  return [...seen.entries()].filter(([, count]) => count > 1).map(([text]) => text.length);',
  '}',
].join('\n');

describe('the clones reader', () => {
  it('finds a block pasted into a second file', async () => {
    const files: Record<string, string> = {
      'packages/a/src/one.ts': `export const before = 1;\n${BLOCK}\n`,
      'packages/b/src/two.ts': `${BLOCK.replace('settle', 'settleAgain')}\nexport const after = 2;\n`,
    };
    const found = (await clonesIn(Object.keys(files), (file: string) => files[file])) as readonly Clone[];

    expect(found.map((clone) => [clone.a.at, clone.b.at].sort())).toEqual([
      ['packages/a/src/one.ts', 'packages/b/src/two.ts'],
    ]);
  });

  it('finds a block pasted from TypeScript into TSX and JavaScript, each against the first copy', async () => {
    const files: Record<string, string> = {
      'packages/a/src/one.ts': `${BLOCK.replace(/: [^,)=]+(?=[,)])/g, '')}\n`,
      'packages/b/src/two.tsx': `${BLOCK.replace(/: [^,)=]+(?=[,)])/g, '')}\n`,
      'tools/three.mjs': `${BLOCK.replace(/: [^,)=]+(?=[,)])/g, '')}\n`,
    };
    const found = (await clonesIn(Object.keys(files), (file: string) => files[file])) as readonly Clone[];

    expect(paired(found).map((pair) => (pair as Pair).files)).toEqual([
      ['packages/a/src/one.ts', 'packages/b/src/two.tsx'],
      ['packages/a/src/one.ts', 'tools/three.mjs'],
    ]);
  });

  it('counts each pasted block between one pair once, whichever file came first', () => {
    const clone = (a: string, b: string): Clone => ({ a: { at: a, lines: [1, 9] }, b: { at: b, lines: [1, 9] } });

    expect(paired([clone('y.ts', 'x.ts'), clone('x.ts', 'y.ts'), clone('x.ts', 'x.ts')])).toEqual([
      { files: ['x.ts', 'x.ts'], count: 1 },
      { files: ['x.ts', 'y.ts'], count: 2 },
    ]);
  });

  it.todo('reads the Rust addon — needs `native/src` listed apart from its `_tests.rs` files, and `rust` mapped as a format');
});

describe('pasted code', async () => {
  const now = paired(await clones()) as readonly Pair[];
  const before = JSON.parse(readFileSync(BASELINE, 'utf8')) as readonly Pair[];
  const key = (pair: Pair): string => pair.files.join(' <> ');
  const recorded = new Map(before.map((pair) => [key(pair), pair.count]));
  const counts = new Map(now.map((pair) => [key(pair), pair.count]));

  it('does not spread', () => {
    const grown = now
      .filter((pair) => pair.count > (recorded.get(key(pair)) ?? 0))
      .map((pair) => `${key(pair)}: ${pair.count} clone(s), ${recorded.get(key(pair)) ?? 0} recorded`);

    expect(
      grown.length === 0
        ? ''
        : `${grown.length} pair(s) of files share more pasted code than recorded:\n\n  ${grown.join('\n  ')}\n\n` +
            '`yarn clones` prints the lines. Make one implementation and call it from both places. ' +
            'If the two must stay apart, say why at both sites and record it with `yarn clones --write`.',
    ).toBe('');
  });

  it('leaves the baseline no longer than what it records', () => {
    const closed = before
      .filter((pair) => (counts.get(key(pair)) ?? 0) < pair.count)
      .map((pair) => `${key(pair)}: ${pair.count} recorded, ${counts.get(key(pair)) ?? 0} now`);

    expect(
      closed.length === 0
        ? ''
        : `${closed.length} recorded pair(s) share less now:\n\n  ${closed.join('\n  ')}\n\n` +
            'Tighten the ratchet with `yarn clones --write`.',
    ).toBe('');
  });

  it('is read from a repository that was actually read', () => {
    expect(now.length + before.length).toBeGreaterThan(0);
  });
});
