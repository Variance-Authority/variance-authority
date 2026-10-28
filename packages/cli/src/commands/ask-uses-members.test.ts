import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a member of an interface, a type literal or a
 * class, and `variance ask grep --to`. A member is never imported, so `uses`
 * names its declarations, which the scan records, and says that a use whose
 * type the line does not write is TypeScript's to find, at the declaration it
 * names. The text search over the files that import a declaring file finds
 * the name as text. An object literal's key declares nothing, and a file that
 * does not import the declaration is not searched.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-members-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const SCANNER = {
  'packages/lib/src/native.ts':
    'export interface Scanner {\n  resolveThings?(root: string): string[];\n}\n\nexport function scanner(): Scanner {\n  return {};\n}\n',
  'packages/lib/src/effects.ts':
    "import { scanner } from './native.js';\nconst held = scanner();\nexport const things = held.resolveThings!('.');\nexport const has = typeof held.resolveThings === 'function';\n",
  'packages/lib/src/references.ts':
    "import { things } from './effects.js';\nimport { scanner } from './native.js';\nconst { resolveThings } = scanner();\nexport const all = [things, resolveThings];\n",
  'packages/lib/src/references.test.ts':
    "import { scanner } from './native.js';\nexport const probe = scanner()['resolveThings'];\n",
  'packages/lib/src/accessor.ts':
    "import type { Scanner } from './native.js';\nconst entry = <K extends keyof Scanner>(key: K) => key;\nexport const resolve = entry('resolveThings');\n",
  'packages/kit/src/elsewhere.ts': 'export const other = { resolveThings: () => [] };\nexport const read = other.resolveThings();\n',
};

const STOP =
  "A use is listed here only where its line writes the value's type. A use through an inferred value, a generic, a subtype by `extends`, " +
  "a JSX attribute, a utility type or an inline type literal is not: which type a value has is a type checker's answer, and none runs here.";
const ROUTE = "Ask TypeScript for those: its language service's find-references on `Scanner.resolveThings` at packages/lib/src/native.ts:2.";

describe('variance ask uses over a member', () => {
  it('names the declaration of an interface member and hands the uses no line types to TypeScript at that declaration', async () => {
    checkout(SCANNER);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'resolveThings']);
    expect(code).toBe(EXIT_CLEAN);
    // `references.ts` binds the name at its top level, by destructuring, and
    // that declaration is answered before the member's.
    expect(out).toContain('`resolveThings` [const] is declared, not exported, at packages/lib/src/references.ts:3, so nothing outside that file can import it.');
    expect(out).toContain('`resolveThings` is a member too, declared in 1 place:');
    expect(out).toMatch(/^packages\/lib\/src\/native\.ts:2 — Scanner$/m);
    expect(out).toContain(`${STOP}\n${ROUTE}`);
    expect(out).not.toContain('docs_grep');
    expect(out).not.toContain('elsewhere.ts');
  });

  it('says nothing of types for a name that is no member', async () => {
    checkout(SCANNER);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'scanner']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/lib\/src\/effects\.ts:1 — @acme\/lib; used on line 2$/m);
    expect(out).not.toContain('type checker');
    expect(out).not.toContain('find-references');
  });

  it('finds the callers of a member in the files that import its declaration', async () => {
    checkout(SCANNER);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'grep', '--query', '\\bresolveThings\\b', '--to', 'packages/lib/src/native.ts']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/lib\/src\/effects\.ts:3:/m);
    expect(out).toMatch(/^packages\/lib\/src\/references\.ts:3:/m);
    expect(out).toMatch(/^packages\/lib\/src\/references\.test\.ts:2:/m);
    expect(out).toMatch(/^packages\/lib\/src\/accessor\.ts:3:/m);
    expect(out).not.toContain('elsewhere.ts');
  });

  it('lists every file that declares a member, as the newest index reads each one', async () => {
    checkout({
      ...SCANNER,
      'packages/kit/src/held.ts': 'export class Held {\n  constructor(private resolveThings: () => string[]) {}\n}\n',
      'packages/lib/src/legacy.ts': 'export type Legacy = {\n  resolveThings(): string[];\n};\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    // The second index layers over the first: `native.ts` is rewritten, its
    // declaration three lines lower and a second container beside it,
    // `legacy.ts` drops its declaration, and `held.ts` is read as it was.
    const root = process.cwd();
    writeFileSync(
      join(root, 'packages/lib/src/native.ts'),
      '// Moved.\n\n\nexport interface Scanner {\n  resolveThings?(root: string): string[];\n}\n\nexport interface Later {\n  resolveThings(): void;\n}\n\nexport function scanner(): Scanner {\n  return {};\n}\n',
    );
    writeFileSync(join(root, 'packages/lib/src/legacy.ts'), 'export type Legacy = {\n  other(): string[];\n};\n');
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'resolveThings']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`resolveThings` is a member too, declared in 3 places:');
    const listed = out.split('\n').filter((line) => / — /.test(line) && /\.ts:\d+/.test(line));
    // `references.ts` destructures its own `resolveThings` and reads it a line
    // later, which is a use in the declaring file, listed before the members.
    expect(listed).toEqual([
      'packages/lib/src/references.ts:4 — @acme/lib',
      'packages/kit/src/held.ts:2 — Held',
      'packages/lib/src/native.ts:5 — Scanner',
      'packages/lib/src/native.ts:9 — Later',
    ]);

    // Crossed with another question, the file declaring it twice is one file
    // at both lines.
    const crossed = await run(['ask', 'intersection', 'uses --name resolveThings', 'discover --path native']);
    expect(crossed.code).toBe(EXIT_CLEAN);
    expect(crossed.out).toContain('packages/lib/src/native.ts — 1: lines 5, 9 · 2: the file');
  });

  it('answers a name that is exported and a member with its imports, then its declarations', async () => {
    checkout({
      ...SCANNER,
      'packages/lib/src/wrap.ts': 'export function resolveThings(): string[] {\n  return [];\n}\n',
      'packages/lib/src/wrapped.ts': "import { resolveThings } from './wrap.js';\nexport const wrapped = resolveThings();\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'resolveThings']);
    expect(code).toBe(EXIT_CLEAN);
    const imported = out.search(/^packages\/lib\/src\/wrapped\.ts:1 — @acme\/lib; used on line 2$/m);
    const member = out.indexOf('`resolveThings` is a member too, declared in 1 place:');
    expect(imported).toBeGreaterThanOrEqual(0);
    expect(member).toBeGreaterThan(imported);
    expect(out.slice(member)).toMatch(/^packages\/lib\/src\/native\.ts:2 — Scanner$/m);
    expect(out.slice(member)).toContain(ROUTE);
  });

  it('says where its reading of members stops for a name nothing declares, naming the languages whose members were not read', async () => {
    checkout({ ...SCANNER, 'tools/scan.py': 'class Scanner:\n    def scan_things(self):\n        return []\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'scan_things']);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).toContain('`scan_things` is not published by this workspace');
    expect(out).toContain('No file in this workspace declares `scan_things` at its top level, and no JavaScript or TypeScript file declares it as a member.');
    expect(out).toContain(
      "Members are read from JavaScript and TypeScript files only, and this workspace's Python files were not read for them: " +
        "if `scan_things` is a member there, ask their language server's workspace symbols for it, then its find-references on the declaration.",
    );
  });

  it('says, under the members it lists, that the languages whose members were not read may declare it too', async () => {
    checkout({ ...SCANNER, 'tools/scan.py': 'class Scanner:\n    def resolveThings(self):\n        return []\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'resolveThings']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain(
      `${STOP}\n${ROUTE}\nMembers are read from JavaScript and TypeScript files only, and this workspace's Python files were not read for them: ` +
        "if `resolveThings` is a member there too, ask their language server's workspace symbols for it, then its find-references on the declaration.",
    );
  });

  it('says nothing of other languages for a name nothing declares in a workspace of JavaScript and TypeScript', async () => {
    checkout(SCANNER);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'scan_things']);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).toContain('`scan_things` is not published by this workspace');
    expect(out).not.toContain('Members are read');
  });

  it('answers a name nothing publishes, saying the member declarations went unread, when no source index is published and `--just-answer` reads the generation as it is', async () => {
    const root = checkout(SCANNER);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    rmSync(sourceIndexPath(root));

    const { code, out, err } = await run(['ask', 'uses', '--name', 'resolveThings', '--just-answer']);
    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
    expect(out).toContain('`resolveThings` is not published by this workspace, and no published name contains it');
    expect(out).toContain('Which files declare `resolveThings` is not known: no source index is published; run `variance index`.');
  });
});
