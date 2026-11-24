import { describe, expect, it } from 'vitest';
import { wordsOf } from '../words.js';
import { formatClassified, type StartPoint } from './classify-words.js';

const places = { current: true, packages: new Map() };
const reading = { entities: [], plain: ['retry', 'transfer'] };

function continuation(path: string, said: StartPoint): readonly (readonly string[])[] {
  const text = formatClassified(reading, places, [{ path, files: 1, words: reading.plain, declares: true }], said);
  const line = text.split('\n').find((one) => one.startsWith('  variance ask '));
  const words = wordsOf(line ?? '');
  expect(words.slice(0, 3)).toEqual(['variance', 'ask', 'intersection']);
  expect(words).toHaveLength(5);
  return words.slice(3).map(wordsOf);
}

describe('classified area continuations', () => {
  it('retains every original direction and start point inside the search operand', () => {
    const questions = continuation('packages/shared', {
      from: ['packages/product/', 'src/second.ts'],
      to: ['src/target.ts', 'src/another.ts'],
    });
    expect(questions).toEqual([
      ['search', '--query', 'retry transfer', '--from', 'packages/product/', '--from', 'src/second.ts', '--to', 'src/target.ts', '--to', 'src/another.ts'],
      ['discover', '--path', '^packages/shared/'],
    ]);
  });

  it.each(['packages/shared.v2', 'packages/shared[beta]', "packages/team's shared (new)+$^{}|?*"])(
    'preserves shell and regex punctuation in the literal directory %s', (path) => {
      const from = "packages/caller's app/";
      const questions = continuation(path, { from: [from] });
      expect(questions[0]).toEqual(['search', '--query', 'retry transfer', '--from', from]);
      const pattern = questions[1]?.[2];
      expect(questions[1]?.slice(0, 2)).toEqual(['discover', '--path']);
      const member = new RegExp(pattern!);
      expect(member.test(`${path}/retry.ts`)).toBe(true);
      expect(member.test(`${path}-extra/retry.ts`)).toBe(false);
      expect(member.test(`other/${path}/retry.ts`)).toBe(false);
      expect(member.test(`${path.replace(/[.[\]()]/g, '_')}/retry.ts`)).toBe(false);
    },
  );

  it('retains the plain search controls when no scoped nonroot declaring area exists', () => {
    const area = { path: 'packages/shared', files: 1, words: reading.plain, declares: true };
    const asked = (areas: readonly typeof area[], said: StartPoint): string => formatClassified(reading, places, areas, said);
    expect(asked([], { from: ['src/'] })).not.toContain('variance ask search');
    expect(asked([{ ...area, path: '.' }], { from: ['src/'] })).toContain("variance ask search --query 'retry transfer' --from src/");
    expect(asked([{ ...area, declares: false }], { to: ['src/target.ts'] })).toContain("variance ask search --query 'retry transfer' --to src/target.ts");
    expect(asked([area], {})).toContain("variance ask search --query 'retry transfer' --from packages/shared");
  });
});
