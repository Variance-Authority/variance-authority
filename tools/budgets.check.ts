import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, BUDGET, MODULES, judge, leadOf, overBudget, surfacesOf, tracked } from './budgets.mjs';

/**
 * Every written surface has a budget, and a breach is collapsed where it happens.
 *
 * The debt recorded in `tools/budgets.baseline.json` is held per file, kind and
 * scope, largest first. A change may not add to it: a surface that grows past
 * its entry, or a new one over budget, is collapsed to about half its budget in
 * the same change, its overflow moved to the owner. A debt entry that shrinks is
 * written down with `yarn budgets --write`, so a line given back stays given back.
 */

const lines = (count: number, prefix = ' * '): string =>
  Array.from({ length: count }, (_, at) => `${prefix}Line ${at + 1} says something.`).join('\n');

describe('a surface is told by what its comment is attached to', () => {
  it('reads the overview under a compass coordinate as the overview, not a block', () => {
    const text = `// compass: cli/clone\n/**\n${lines(13)}\n */\nimport { a } from 'a';\n\nexport const b = a;\n`;

    expect(surfacesOf('x.ts', text)).toEqual([{ kind: 'overview', scope: '', line: 2, lines: 13 }]);
  });

  it('reads a docblock on the first export as that docblock, not an overview', () => {
    const text = `import { a } from 'a';\n\n/**\n${lines(11)}\n */\nexport function settle() {\n  return a;\n}\n`;

    expect(surfacesOf('x.ts', text)).toEqual([{ kind: 'docblock', scope: 'settle', line: 3, lines: 11 }]);
  });

  it('keys a member docblock by its declared path', () => {
    const text = `export interface Settlement {\n  /**\n${lines(2, '   * ')}\n   */\n  readonly missingFonts?: string[];\n}\n`;

    expect(surfacesOf('x.ts', text)).toEqual([
      { kind: 'docblock', scope: 'Settlement.missingFonts', line: 2, lines: 2 },
    ]);
  });

  it('keys a block by the declaration it sits in, and skips one-line comments', () => {
    const text = `export const a = 1;\nfunction run() {\n  // one line\n  const b = 2;\n${lines(6, '  // ')}\n  return b;\n}\n`;

    expect(surfacesOf('x.ts', text)).toEqual([{ kind: 'block', scope: 'run', line: 5, lines: 6 }]);
  });

  it('counts a `Word: value` line and drops a bare tag', () => {
    const text = `export const a = 1;\n/**\n * Why: safety.\n * @internal\n * {@link a}\n */\nexport const b = a;\n`;

    expect(surfacesOf('x.ts', text)).toEqual([{ kind: 'docblock', scope: 'b', line: 2, lines: 1 }]);
  });

  it('reads no comment inside a string', () => {
    const text = `export const url = 'https://a/*b';\nexport const c = \`/* \${url} */\`;\n`;

    expect(surfacesOf('x.ts', text)).toEqual([]);
  });

  it('reads a lead as the lines between the title and the first section', () => {
    expect(leadOf('---\nx: 1\n---\n# Title\n\nOne.\nTwo.\n\n## Next\n\nThree.\n')).toBe(2);
    expect(leadOf('No title.\n')).toBeUndefined();
  });
});

describe('the debt only shrinks', () => {
  const recorded = { 'a.ts block run': [9, 7] };

  it('refuses a surface that grew past its entry, and a new breach', () => {
    expect(judge(recorded, new Map([['a.ts block run', [10, 7]]])).grown).toEqual(['a.ts block run: 10, 7 (held at 9, 7)']);
    expect(judge(recorded, new Map([['a.ts block run', [9, 7, 6]]])).grown).toEqual(['a.ts block run: 9, 7, 6 (held at 9, 7)']);
    expect(judge({}, new Map([['b.ts overview', [16]]])).grown).toEqual(['b.ts overview: 16 (held at nothing)']);
  });

  it('asks for the entry to come down when a surface shrank or left', () => {
    expect(judge(recorded, new Map([['a.ts block run', [8, 7]]])).slack).toEqual(['a.ts block run: 8, 7 (held at 9, 7)']);
    expect(judge(recorded, new Map()).slack).toEqual(['a.ts block run: nothing (held at 9, 7)']);
    expect(judge(recorded, new Map([['a.ts block run', [9, 7]]]))).toEqual({ grown: [], slack: [] });
  });
});

describe('the repository', () => {
  const { surfaces, debt } = overBudget(MODULES, tracked('*.md'));
  const { grown, slack } = judge(JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number[]>, debt);

  it('adds nothing over budget', () => {
    expect(
      grown.length === 0
        ? ''
        : `${grown.length} surface(s) grew over budget:\n\n  ${grown.join('\n  ')}\n\n` +
            `Collapse each to about half its budget (${Object.entries(BUDGET).map(([kind, n]) => `${kind} ${n}`).join(', ')}) ` +
            'in this change: move the overflow down to the site it governs, up to the folder or package ' +
            'that owns it, or to the docblock of the export it describes. A file over 500 lines is split ' +
            'by responsibility the same way.',
    ).toBe('');
  });

  it('records no debt that was paid', () => {
    expect(
      slack.length === 0 ? '' : `${slack.length} recorded surface(s) shrank:\n\n  ${slack.join('\n  ')}\n\nRun \`yarn budgets --write\`.`,
    ).toBe('');
  });

  it('read surfaces, so it cannot pass by reading nothing', () => {
    expect(surfaces).toBeGreaterThan(1000);
  });
});
