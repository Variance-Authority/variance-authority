import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * The text `ask symbol` prints of a doc comment, a signature and a member's
 * line is cut once, from the slice of the source the index read, by one rule
 * whichever producer published the answer: a cold `variance index`, or the
 * re-index that refreshes it. The fixture is written with CRLF line ends and
 * holds what each rule could read differently: a margin with more than one
 * space after its `*`, a line led by `**`, a character outside the Basic
 * Multilingual Plane, and a signature ending in `;`. The answers are the ones a
 * cold index printed before the index kept the text, a carriage return the doc
 * keeps written as `<CR>`.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-text-cut-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const CUT = [
  '/**',
  ' * Opens the door.',
  ' *',
  ' *   door.open()',
  ' ** Led by two marks',
  ' * Wears \u{1F600} a pair',
  ' */',
  'export function opened(door: string): string {',
  '  return door;',
  '}',
  '',
  '/** Rated, and declared only. */',
  'export declare const declaredRate: number;',
  '',
  '/**',
  ' *   Halves it,',
  ' *     and keeps the half.',
  ' */',
  'function halvedOf(amount: number): number {',
  '  return amount / 2;',
  '}',
  'export const halved = halvedOf(4);',
  '',
  'export interface Door {',
  '  /** Whether it is open. */',
  '  readonly open: boolean;',
  '  close(): void;',
  '}',
  '',
].join('\r\n');

const QUESTIONS = [
  ['symbol', '--name', 'opened'],
  ['symbol', '--name', 'declaredRate'],
  ['symbol', '--name', 'halvedOf'],
  ['symbol', '--name', 'Door'],
  ['search', '--query', 'marks pair'],
  ['search', '--query', 'rated declared'],
] as const;

async function answers(): Promise<readonly string[]> {
  const asked: string[] = [];
  for (const question of QUESTIONS) {
    const { code, out } = await run(['ask', ...question]);
    expect(code).toBe(EXIT_CLEAN);
    asked.push(out.replace(/^Snapshot .*$/gmu, 'Snapshot').replaceAll('\r', '<CR>'));
  }
  return asked;
}

describe('ask symbol, the text it prints of a doc, a signature and a member', () => {
  it('prints what a cold index printed, from the cold index and from the re-index that refreshes it', async () => {
    const root = checkout({ 'packages/kit/src/cut.ts': CUT });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const cold = await answers();
    expect(cold).toMatchInlineSnapshot(`
      [
        "opened [function]
      exported, without being published, at packages/kit/src/cut.ts:8 by @acme/kit
      function opened(door: string): string
      Opens the door.<CR>
      <CR>
        door.open()<CR>
      * Led by two marks<CR>
      Wears 😀 a pair
      Nothing in this workspace imports it; a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted.
      Snapshot
      ",
        "declaredRate [const]
      exported, without being published, at packages/kit/src/cut.ts:13 by @acme/kit (type only)
      declare const declaredRate: number
      Rated, and declared only.
      Nothing in this workspace imports it; a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted.
      Snapshot
      ",
        "halvedOf [function]
      declared, not exported, at packages/kit/src/cut.ts:19 by @acme/kit
      function halvedOf(amount: number): number
      Halves it,<CR>
          and keeps the half.
      Nothing outside packages/kit/src/cut.ts can import it: no export of that file names it.
      Snapshot
      ",
        "Door [interface]
      exported, without being published, at packages/kit/src/cut.ts:24 by @acme/kit (type only)
      interface Door
      Nothing in this workspace imports it; a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted.

      Members:
      packages/kit/src/cut.ts:26 — readonly open: boolean;
      packages/kit/src/cut.ts:27 — close(): void;
      Snapshot
      ",
        "No export, top-level declaration or member of a class, an interface or a type in this repository, nor the doc of one, nor a function inside a function, writes \`marks pair\`. The nearest follow.

      No recorded case was read: no run kept its cases there.

      Near matches, not exact: 1 name or file in this repository holds most of \`marks pair\`, the rarer words counting for more, read by stem as the packages are, best first: the words held, each counted by how few rows hold it and more in the name than in a doc, more in a doc than in a signature, then the words in the name, then the phrase its doc writes; a row for each word these rows hold is shown however it sorts.

      opened — @acme/kit · packages/kit/src/cut.ts:8 — Opens the door. door.open() * Led by two marks Wears 😀 a pair [holds: marks, pair]

      No third-party name matches \`marks pair\`. No dependency was searched: no manifest in reach declares or imports one.
      Snapshot
      ",
        "Nothing published matches \`rated declared\`.

      1 more name is exported somewhere in the repository without being published:

      declaredRate — @acme/kit · packages/kit/src/cut.ts:13 — Rated, and declared only.

      From a file above to what surrounds it: \`variance ask orient --files packages/kit/src/cut.ts\`.

      No recorded case was read: no run kept its cases there.

      No third-party name matches \`rated declared\`. No dependency was searched: no manifest in reach declares or imports one.
      Snapshot
      ",
      ]
    `);

    writeFileSync(join(root, 'packages/kit/src/orphan.ts'), 'export const orphan = 2;\n');
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    expect(await answers()).toEqual(cold);
  });
});
