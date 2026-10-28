import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask symbol` over an interface, a type alias and a class: the
 * signature is what is written before the body, so the members are listed
 * after it, each at its line as the checkout holds it, published or not.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-members-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const SHAPES = {
  'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport type { Card } from './card.js';\n",
  'packages/lib/src/card.ts': '/** A card on the board. */\nexport interface Card {\n  /** What it says. */\n  title: string;\n  flip(): Card;\n}\n',
  'packages/lib/src/shapes.ts':
    'export interface Shape {\n  /** How wide. */\n  readonly width: number;\n  area(): number;\n  nested: { inner: number };\n  deep: {\n    hidden: number;\n  };\n}\n' +
    'export type Pair = {\n  left: number;\n  right: number;\n};\nexport type Id = string;\nexport type Flat = { one: 1; two: 2 };\n' +
    'export class Box {\n  size = 1;\n  open(): void {}\n}\n',
  'packages/lib/src/inner.ts': "import type { Shape, Pair, Id, Flat } from './shapes.js';\nimport { Box } from './shapes.js';\nexport const box = new Box();\n",
};

/** The member rows of `out`. */
const members = (out: string): readonly string[] => {
  const lines = out.split('\n');
  const from = lines.indexOf('Members:');
  if (from === -1) return [];
  // A member row names its line; the answer's footer follows the last one.
  const end = lines.findIndex((line, at) => at > from && !/^\S+:\d+ — /.test(line));
  return lines.slice(from + 1, end === -1 ? undefined : end);
};

describe('variance ask symbol over a container', () => {
  it('lists the members of an interface no entry publishes, and not those of a type literal inside it', async () => {
    checkout(SHAPES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'Shape']);
    expect(code).toBe(EXIT_CLEAN);
    expect(members(out)).toEqual([
      'packages/lib/src/shapes.ts:3 — readonly width: number;',
      'packages/lib/src/shapes.ts:4 — area(): number;',
      'packages/lib/src/shapes.ts:5 — nested: { inner: number };',
      'packages/lib/src/shapes.ts:6 — deep: {',
    ]);
  });

  it('lists the members of a published interface after its signature and doc', async () => {
    checkout(SHAPES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'Card']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('A card on the board.');
    expect(members(out)).toEqual(['packages/lib/src/card.ts:4 — title: string;', 'packages/lib/src/card.ts:5 — flip(): Card;']);
  });

  it('lists the members of a type alias and a class, and none for an alias the line already shows', async () => {
    checkout(SHAPES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const pair = await run(['ask', 'symbol', '--name', 'Pair']);
    expect(members(pair.out)).toEqual(['packages/lib/src/shapes.ts:11 — left: number;', 'packages/lib/src/shapes.ts:12 — right: number;']);

    const box = await run(['ask', 'symbol', '--name', 'Box']);
    expect(members(box.out)).toEqual(['packages/lib/src/shapes.ts:17 — size = 1;', 'packages/lib/src/shapes.ts:18 — open(): void {}']);

    const flat = await run(['ask', 'symbol', '--name', 'Flat']);
    expect(flat.out).toContain('Flat [type]\n');
    expect(flat.out).toContain('type Flat = { one: 1; two: 2 }');
    expect(members(flat.out)).toEqual([]);

    const id = await run(['ask', 'symbol', '--name', 'Id']);
    expect(members(id.out)).toEqual([]);
  });

  // The source index records the container a member is on by its name alone,
  // so a container nested in a function and a top-level one of the same name
  // in one file share their members. Declarations TypeScript merges, two
  // `interface`s of one name, are one type and list together rightly.
  it.todo('lists only its own members for a container whose name a nested container in its file shares — needs `member-declarations` to record the container a member is on by its place, not its name alone');
});
