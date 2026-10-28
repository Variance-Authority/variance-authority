import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a field of an interface or a type alias: the lines
 * that read it, write it or destructure it, each under the declaration it
 * belongs to. A use is tied to a declaration by the type its value is written
 * with — a parameter's or a variable's annotation, an `as` or a `satisfies` —
 * and that type's name is followed through the import that binds it, renamed
 * or passed on by a barrel, to the file that declares it. A value whose type is
 * not written, or is written as an inline type literal, is no use of either
 * declaration, however its field is spelled.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-fields-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const SHAPES = {
  'packages/lib/src/shapes/props.ts':
    'export interface Props {\n  size: number;\n  label?: string;\n}\n\nexport type Other = {\n  size: string;\n};\n\nexport interface Spare {\n  size: boolean;\n}\n',
  'packages/lib/src/shapes/index.ts': "export * from './props.js';\n",
  'packages/lib/src/shapes/use.ts': [
    "import type { Props } from './props.js';",
    'export function area(props: Props): number {',
    '  return props.size * props.size;',
    '}',
    'export function grow(props: Props): void {',
    '  props.size += 2;',
    '}',
    'export const Label = ({ size, label }: Props) => `${label}:${size}`;',
    'export function shadow(props: Props): number[] {',
    '  return [{ size: 1 }].map((props) => props.size);',
    '}',
    'const fixed: Props = { size: 3 };',
    'export const half = (p?: Props) => p?.size;',
    'export const cast = (value: unknown) => (value as Props).size;',
    'export const checked = { size: 4 } satisfies Props;',
    '',
  ].join('\n'),
  'packages/lib/src/shapes/other.ts': [
    "import type { Other as Renamed } from './props.js';",
    'export const shout = (o: Renamed) => o.size.toUpperCase();',
    'export const untyped = (o: { size: number }) => o.size;',
    'export function inferred(o: Renamed) {',
    '  const copy = o;',
    '  return copy.size;',
    '}',
    '',
  ].join('\n'),
  'packages/lib/src/shapes/far.test.ts':
    "import type { Props } from './index.js';\nexport const read = (p: Props) => p['size'];\n",
  'apps/app/src/fit.ts': "import type { Props } from '@acme/lib/src/shapes/props';\nexport const fit = (props: Props) => props.size > 2;\n",
};

/** The lines of `out` from the one that opens with `heading` to the next blank line after its list. */
function section(out: string, heading: string): readonly string[] {
  const lines = out.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const rest = lines.slice(start + 2);
  const end = rest.indexOf('');
  return end < 0 ? rest : rest.slice(0, end);
}

describe('variance ask uses over a field of an interface or a type', () => {
  it('answers each declaration of the field with the lines that read, write or destructure it', async () => {
    checkout(SHAPES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`size` is no exported name; it is a member, declared in 4 places:');
    expect(out).toMatch(/^packages\/lib\/src\/shapes\/other\.ts:3 — a type literal$/m);
    expect(out).toMatch(/^packages\/lib\/src\/shapes\/props\.ts:2 — Props$/m);
    expect(out).toMatch(/^packages\/lib\/src\/shapes\/props\.ts:7 — Other$/m);
    expect(out).toMatch(/^packages\/lib\/src\/shapes\/props\.ts:11 — Spare$/m);

    expect(section(out, '`Props.size`, declared at packages/lib/src/shapes/props.ts:2, is used in 9 places:')).toEqual([
      'apps/app/src/fit.ts:2 — @acme/app, read',
      'packages/lib/src/shapes/far.test.ts:2 — @acme/lib, read',
      'packages/lib/src/shapes/use.ts:3 — @acme/lib, read',
      'packages/lib/src/shapes/use.ts:6 — @acme/lib, write',
      'packages/lib/src/shapes/use.ts:8 — @acme/lib, destructure',
      'packages/lib/src/shapes/use.ts:12 — @acme/lib, write',
      'packages/lib/src/shapes/use.ts:13 — @acme/lib, read',
      'packages/lib/src/shapes/use.ts:14 — @acme/lib, read',
      'packages/lib/src/shapes/use.ts:15 — @acme/lib, write',
    ]);
    expect(section(out, '`Other.size`, declared at packages/lib/src/shapes/props.ts:7, is used in 1 place:')).toEqual([
      'packages/lib/src/shapes/other.ts:2 — @acme/lib, read',
    ]);
    // A named container no line types is named once; a type literal has no name a line could write, so it is not.
    expect(out).toContain('No line uses `size` through a value whose type is written as `Spare` at packages/lib/src/shapes/props.ts:11.');
    expect(out).not.toContain('written as `a type literal`');
    // Four declarations: TypeScript is asked at the one the reader means.
    expect(out).toContain(
      "Ask TypeScript for those: its language service's find-references on the declaration you mean, each listed above with its file and line (`--package` narrows the declarations to one package).",
    );
  });

  it('answers a field used through a barrel that passes its type on with `export type { … } from`', async () => {
    checkout({
      'packages/lib/src/shapes/props.ts': 'export interface Props {\n  size: number;\n}\n',
      'packages/lib/src/shapes/types.ts': "export type { Props } from './props.js';\n",
      'packages/lib/src/shapes/far.ts': "import type { Props } from './types.js';\nexport const read = (p: Props) => p.size;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size']);
    expect(code).toBe(EXIT_CLEAN);
    expect(section(out, '`Props.size`, declared at packages/lib/src/shapes/props.ts:2, is used in 1 place:')).toEqual([
      'packages/lib/src/shapes/far.ts:2 — @acme/lib, read',
    ]);
  });
});
