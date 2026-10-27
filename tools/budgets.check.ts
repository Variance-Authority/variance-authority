import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, BUDGET, judge, leadOf, overBudget, recordable, surfacesOf } from './budgets.mjs';
import { MODULES, tracked } from './modules.js';

/**
 * Every written surface has a budget, and a breach is collapsed where it happens.
 *
 * The debt recorded in `tools/budgets.baseline.json` is held per file and kind,
 * largest first. A change may not add to it: a surface that grows past
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

  it('reads a hashbang as no comment, so the overview under the imports keeps its slot', () => {
    const text = `#!/usr/bin/env node\nimport { a } from 'a';\n\n/**\n${lines(6)}\n */\n\nexport const b = a;\n`;

    expect(surfacesOf('x.mjs', text)).toEqual([{ kind: 'overview', scope: '', line: 4, lines: 6 }]);
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
    expect(leadOf('```\n# Not\n```\n# T\n\nOne.\n\n```sh\n## c\n```\nTwo.\n\n## S\n')).toBe(5);
  });
});

describe('the debt is keyed by file and kind', () => {
  const block = (name: string): string => `function ${name}() {\n${lines(6, '  // ')}\n}\n`;

  it('holds a renamed scope at its entry, and names where each breach opens', () => {
    const before = overBudget(['a.ts'], [], () => block('run'));
    const after = overBudget(['a.ts'], [], () => block('go'));

    expect([...before.debt]).toEqual([['a.ts block', [6]]]);
    expect(judge(Object.fromEntries(before.debt), after.debt)).toEqual({ grown: [], slack: [] });
    expect(after.where.get('a.ts block')).toEqual(['a.ts:2 go (6)']);
  });

  it('drops a pragma line, not the comment it opens', () => {
    expect(surfacesOf('x.ts', `function g() {\n  /* eslint-disable no-x\n   real line\n   another */\n}\n`)).toEqual([
      { kind: 'block', scope: 'g', line: 2, lines: 2 },
    ]);
  });

  it('reads a `/**` on a statement as a block, and one on a directive as the overview', () => {
    expect(surfacesOf('x.ts', `export function f() {\n  /**\n   * One.\n   * Two.\n   */\n  return 1;\n}\n`)).toEqual([
      { kind: 'block', scope: 'f', line: 2, lines: 2 },
    ]);
    expect(surfacesOf('x.ts', `/**\n * One.\n */\n'use client';\nexport const b = 1;\n`)).toEqual([
      { kind: 'overview', scope: '', line: 1, lines: 1 },
    ]);
  });

  it('attaches a docblock past a blank line once the overview is behind it', () => {
    expect(surfacesOf('x.ts', `export const a = 1;\n\n/**\n * One.\n * Two.\n */\n\nexport function f() {}\n`)).toEqual([
      { kind: 'docblock', scope: 'f', line: 3, lines: 2 },
    ]);
  });

  it('names a variable scope once, and a default export by `default`', () => {
    expect(surfacesOf('x.ts', `export const a = {\n  b() {\n    // x\n    // y\n  },\n};\n`)).toEqual([
      { kind: 'block', scope: 'a.b', line: 3, lines: 2 },
    ]);
    expect(surfacesOf('x.ts', `export const a = 1;\n/** One. */\nexport default defineConfig({});\n`)).toEqual([
      { kind: 'docblock', scope: 'default', line: 2, lines: 1 },
    ]);
  });

  it('refuses to record growth', () => {
    expect(() => recordable({ 'a.ts block': [6] }, new Map([['a.ts block', [7]]]))).toThrow('a.ts block: 7 (held at 6)');
    expect(recordable({ 'a.ts block': [6] }, new Map())).toBe('{}\n');
    expect(recordable(undefined, new Map([['a.ts block', [7]]]))).toBe('{\n  "a.ts block": [\n    7\n  ]\n}\n');
  });

  it('reads a re-export as an import, so the overview after it keeps its slot', () => {
    expect(surfacesOf('x.ts', `export * from './a';\nexport { b } from './b';\n\n/**\n * One.\n */\n\nexport const c = 1;\n`)).toEqual([
      { kind: 'overview', scope: '', line: 4, lines: 1 },
    ]);
    expect(surfacesOf('x.ts', `/// <reference types="a" />\n/// <reference types="b" />\nexport const c = 1;\n`)).toEqual([]);
  });

  it('counts a TODO line as content', () => {
    expect(surfacesOf('x.ts', `function run() {\n  // TODO: one.\n  // Two.\n}\n`)).toEqual([
      { kind: 'block', scope: 'run', line: 2, lines: 2 },
    ]);
  });
});

describe('the debt only shrinks', () => {
  const recorded = { 'a.ts block': [9, 7] };

  it('refuses a surface that grew past its entry, and a new breach', () => {
    expect(judge(recorded, new Map([['a.ts block', [10, 7]]])).grown).toEqual(['a.ts block: 10, 7 (held at 9, 7)']);
    expect(judge(recorded, new Map([['a.ts block', [9, 7, 6]]])).grown).toEqual(['a.ts block: 9, 7, 6 (held at 9, 7)']);
    expect(judge({}, new Map([['b.ts overview', [16]]])).grown).toEqual(['b.ts overview: 16 (held at nothing)']);
  });

  it('asks for the entry to come down when a surface shrank or left', () => {
    expect(judge(recorded, new Map([['a.ts block', [8, 7]]])).slack).toEqual(['a.ts block: 8, 7 (held at 9, 7)']);
    expect(judge(recorded, new Map()).slack).toEqual(['a.ts block: nothing (held at 9, 7)']);
    expect(judge(recorded, new Map([['a.ts block', [9, 7]]]))).toEqual({ grown: [], slack: [] });
  });
});

describe('the repository', () => {
  const { surfaces, debt, where } = overBudget(MODULES, tracked('*.md'));
  const grownKeys = (lines: string[]): string[] => lines.map((line) => line.slice(0, line.indexOf(':')));
  const { grown, slack } = judge(JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number[]>, debt);

  it('adds nothing over budget', () => {
    expect(
      grown.length === 0
        ? ''
        : `${grown.length} surface(s) grew over budget:\n\n  ${grown.join('\n  ')}\n\n` +
            `Over budget there now: ${grownKeys(grown).flatMap((key) => where.get(key) ?? []).join(', ')}.\n\n` +
            `Collapse each to about half its budget (${Object.entries(BUDGET).map(([kind, n]) => `${kind} ${n}`).join(', ')}) ` +
            'in this change: move the overflow down to the site it governs, up to the folder or package ' +
            'that owns it, or to the docblock of the export it describes.',
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
