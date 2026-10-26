import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, expect, it } from 'vitest';
import type { Help } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { readWorkspace } from '../read.js';
import { symbol } from './symbol.js';

/**
 * A name is every declaration that spells it. `core` publishes `keyOf`,
 * `react` exports one for a neighbour without publishing it, and seven files
 * keep one to themselves; `wire` publishes `listen`, and `tap.cts` hands its own
 * out through `export =`; `review` exports `outermost` to a neighbour by path,
 * and `distill` keeps one to itself; `solo.test.ts` declares `Solo` inside a
 * callback nobody named, `tape.ts` declares `render` as a member and as a
 * closure, and `pass.ts` hands on an imported `helper` beside a closure of the
 * same name. None of them stands for another.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

let root = '';
let help: Help;
const cache = mkdtempSync(join(tmpdir(), 'va-symbol-namesakes-cache-'));

beforeAll(async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  root = realpathSync(mkdtempSync(join(tmpdir(), 'va-symbol-namesakes-')));
  execFileSync('git', ['init', '--quiet', root]);
  const manifest = (name: string): string => JSON.stringify({ name, exports: { '.': './src/index.ts' } });
  const locals = Object.fromEntries(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letter) => [`packages/locals/src/${letter}.ts`, `function keyOf(): string {\n  return '${letter}';\n}\nexport const ${letter} = keyOf();\n`]),
  );
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'namesakes', private: true, workspaces: ['packages/*'] }),
    'packages/core/package.json': manifest('@x/core'),
    'packages/core/src/index.ts': '/** The key of a published thing. */\nexport function keyOf(value: object): string {\n  return String(value);\n}\n',
    'packages/react/package.json': manifest('@x/react'),
    'packages/react/src/index.ts': "export { story } from './story';\n",
    'packages/react/src/story.ts': [
      '/** The key a story is filed under. */',
      'export function keyOf(title: string, name: string): string {',
      '  return `${title}/${name}`;',
      '}',
      'export const story = keyOf("a", "b");',
      '',
    ].join('\n'),
    'packages/wire/package.json': manifest('@x/wire'),
    'packages/wire/src/index.ts': 'export function listen(port: number): void {\n  void port;\n}\n',
    'packages/sense/package.json': JSON.stringify({ name: '@x/sense' }),
    'packages/sense/src/tap.cts': [
      '/** Hears what one tap says. */',
      'function listen(tap: string, scope: object): void {',
      '  void tap;',
      '  void scope;',
      '}',
      'function tapOf(scope: object): string {',
      '  /** One value, as a tape line spells it. */',
      '  const shown = (value: unknown): string => String(value);',
      '  function kindOf(value: object): string {',
      '    return shown(value);',
      '  }',
      '  return kindOf(scope);',
      '}',
      'export = { listen, tapOf };',
      '',
    ].join('\n'),
    ...locals,
    'packages/sense/src/solo.test.ts': "it('omits createdBy', async () => {\n  function Solo(): number {\n    return 1;\n  }\n  return Solo();\n});\n",
    'packages/sense/src/tape.ts': [
      'export interface Tape {',
      '  render(): string;',
      '}',
      'export function play(tape: Tape): string {',
      '  const render = (): string => tape.render();',
      '  return render();',
      '}',
      '',
    ].join('\n'),
    'packages/review/src/help.ts': '/** Helps. */\nexport function helper(): number {\n  return 1;\n}\n',
    'packages/review/src/pass.ts': "import { helper } from './help.js';\nfunction run(): number {\n  const helper = (): number => 2;\n  return helper();\n}\nexport { helper, run };\n",
    'packages/locals/package.json': JSON.stringify({ name: '@x/locals' }),
    'packages/review/package.json': JSON.stringify({ name: '@x/review' }),
    'packages/review/src/scope.ts': '/** The outermost regions of a file. */\nexport function outermost(file: string): string {\n  return file;\n}\n',
    'packages/review/src/text.ts': "import { outermost } from './scope.js';\nexport const text = outermost('a');\n",
    'packages/distill/package.json': JSON.stringify({ name: '@x/distill' }),
    'packages/distill/src/index.ts': 'function outermost(missed: number): number {\n  return missed;\n}\nexport const distilled = outermost(1);\n',
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  // As `variance ask` reads it: the scan's own exports, `export =` among them.
  help = await readWorkspace(root);
});

const ask = (input: Record<string, unknown>): string => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  return symbol.run(help, input, { root });
};

const filesOf = (name: string): ReadonlyMap<string, readonly number[]> | undefined => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  return symbol.files?.(help, { name }, { root }).files;
};

it('answers an export no entry publishes beside a published namesake', () => {
  const answer = ask({ name: 'keyOf' });
  expect(answer).toContain("import { keyOf } from '@x/core';");
  expect(answer).toContain('exported, without being published, at packages/react/src/story.ts:2 by @x/react');
  expect(answer).toContain('keyOf [function]\n');
  expect(answer).toContain('function keyOf(title: string, name: string): string');
  expect(answer).not.toContain('export function keyOf(');
});

it('counts the declarations it does not write out, and writes out those nearest the file asked from first', () => {
  const answer = ask({ name: 'keyOf' });
  expect(answer).toContain('2 more declarations of `keyOf` not shown.');
  expect(answer).not.toContain('packages/locals/src/f.ts');
  const near = ask({ name: 'keyOf', from: 'packages/locals/src/g.ts' });
  expect(near.indexOf('declared, not exported, at packages/locals/src/g.ts:1')).toBeGreaterThan(-1);
  expect(near.indexOf('declared, not exported, at packages/locals/src/g.ts:1')).toBeLessThan(near.indexOf('packages/locals/src/a.ts:1'));
});

it('answers a name `export =` hands out beside a published namesake', () => {
  const answer = ask({ name: 'listen' });
  expect(answer).toContain("import { listen } from '@x/wire';");
  expect(answer).toContain('exported, without being published, at packages/sense/src/tap.cts:14 by @x/sense');
  const alone = ask({ name: 'tapOf' });
  expect(alone).toContain('exported, without being published, at packages/sense/src/tap.cts:14 by @x/sense');
});

it('answers a closure declared inside a function, with the function that holds it', () => {
  const shown = ask({ name: 'shown' });
  expect(shown).toContain('declared, not exported, at packages/sense/src/tap.cts:8');
  expect(shown).toContain('inside `tapOf`');
  expect(shown).toContain('One value, as a tape line spells it.');
  const kindOf = ask({ name: 'kindOf' });
  expect(kindOf).toContain('declared, not exported, at packages/sense/src/tap.cts:9');
});

it('answers an export a neighbour imports by path beside a namesake another file keeps to itself', () => {
  const answer = ask({ name: 'outermost' });
  expect(answer).toContain('packages/review/src/scope.ts:2');
  expect(answer).toContain('declared, not exported, at packages/distill/src/index.ts:1');
});

it('answers a function declared inside a callback nobody named, with the line of the callback that holds it', () => {
  const answer = ask({ name: 'Solo' });
  expect(answer).toContain('declared, not exported, at packages/sense/src/solo.test.ts:2');
  expect(answer).toContain('Only the function written at packages/sense/src/solo.test.ts:1 can name it: it is declared inside that function.');
});

it('answers a member beside a closure of the same name, since a closure is no top-level declaration', () => {
  const answer = ask({ name: 'render' });
  expect(answer).toContain('a member of `Tape`, declared at packages/sense/src/tape.ts:2');
  expect(answer).toContain('declared, not exported, at packages/sense/src/tape.ts:5');
  expect(answer).toContain('inside `play`');
  expect(filesOf('render')?.get('packages/sense/src/tape.ts')).toEqual(expect.arrayContaining([2, 5]));
});

it('answers an imported name a file hands on from its import, never from a closure that spells it', () => {
  const answer = ask({ name: 'helper' });
  expect(answer).toContain('exported, without being published, at packages/review/src/help.ts:2 by @x/review');
  expect(answer).toContain('declared, not exported, at packages/review/src/pass.ts:3');
  expect(answer).toContain('inside `run`');
  expect(answer).not.toContain('declared at packages/review/src/pass.ts:3\n');
});

it('collects every file that declares a name: published, exported without being published, kept to itself, and inside a function', () => {
  const keyOf = filesOf('keyOf');
  expect(keyOf?.get('packages/core/src/index.ts')).toEqual([2]);
  expect(keyOf?.get('packages/react/src/story.ts')).toEqual([2]);
  for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) expect(keyOf?.get(`packages/locals/src/${letter}.ts`)).toEqual([1]);
  expect(filesOf('shown')?.get('packages/sense/src/tap.cts')).toEqual([8]);
});
