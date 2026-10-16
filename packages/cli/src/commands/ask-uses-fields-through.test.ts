import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a field, where the type a value is checked against
 * is written somewhere other than the value's own binding: the return type of
 * the function that returns it, an interface or a class that carries the
 * field's type (`extends`, `implements`), the class `this` is inside, the
 * props a React component is annotated with, and the props of the component a
 * JSX element renders. The declaring file is read by the same rules as every
 * other file.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-fields-through-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const PROPS = {
  'packages/lib/src/through/props.ts': [
    'export interface Props {',
    '  size: number;',
    '}',
    'export const SELF: Props = { size: 0 };',
    'export const self = (p: Props) => p.size;',
    "export type Size = Props['size'];",
    '',
  ].join('\n'),
};

const TYPES = {
  'packages/lib/src/through/make.ts': [
    "import type { Props } from './props.js';",
    'export function make(): Props {',
    '  return { size: 1 };',
    '}',
    'export const arrow = (): Props => ({ size: 2 });',
    '',
  ].join('\n'),
  'packages/lib/src/through/wide.ts': [
    "import type { Props } from './props.js';",
    'export interface Wide extends Props {',
    '  label: string;',
    '}',
    'export const wide = (w: Wide) => w.size;',
    'export type Mixed = Props & { label: string };',
    '',
  ].join('\n'),
  'packages/lib/src/through/far.ts': [
    "import type { Mixed, Wide } from './wide.js';",
    'export const far = (w: Wide) => w.size;',
    'export const mixed = (m: Mixed) => m.size;',
    '',
  ].join('\n'),
  'packages/lib/src/through/box.ts': [
    "import type { Props } from './props.js';",
    'export class Box implements Props {',
    '  size = 3;',
    '  grow(): number {',
    '    return this.size * 2;',
    '  }',
    '  later(): () => number {',
    '    return function () { return this.size; };',
    '  }',
    '}',
    '',
  ].join('\n'),
  // A field of the same name on a type nothing here writes as `Props`.
  'packages/lib/src/through/other.tsx': [
    'interface Elsewhere {',
    '  size: string;',
    '}',
    'const Odd = ({ size }: Elsewhere) => <s>{size}</s>;',
    'export const odd = <Odd size="x" />;',
    'export class Loose {',
    '  size = 1;',
    '  read(): number {',
    '    return this.size;',
    '  }',
    '}',
    '',
  ].join('\n'),
};

const COMPONENTS = {
  'packages/lib/src/through/Button.tsx': [
    "import type { FC } from 'react';",
    "import * as React from 'react';",
    "import type { Props } from './props.js';",
    'export const Button: FC<Props> = ({ size }) => <b>{size}</b>;',
    'export const Tag: React.FC<Props> = (props) => <i>{props.size}</i>;',
    'export function Plain(props: Props) {',
    '  return <u>{props.size}</u>;',
    '}',
    '',
  ].join('\n'),
  'packages/lib/src/through/page.tsx': [
    "import { Button, Plain, Tag } from './Button.js';",
    'export const page = (',
    '  <>',
    '    <Button size={1} />',
    '    <Plain size={2} />',
    '    <Tag size={3} />',
    '  </>',
    ');',
    '',
  ].join('\n'),
};

/** The declaring file's own uses, which every case reaches. */
const OWN = [
  'packages/lib/src/through/props.ts:4 — @acme/lib, write',
  'packages/lib/src/through/props.ts:5 — @acme/lib, read',
  // An indexed access type reads the field it names.
  'packages/lib/src/through/props.ts:6 — @acme/lib, read',
];

/** The lines of `out` from the one that opens with `heading` to the next blank line after its list. */
function section(out: string, heading: string): readonly string[] {
  const lines = out.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const rest = lines.slice(start + 2);
  const end = rest.indexOf('');
  return end < 0 ? rest : rest.slice(0, end);
}

describe('variance ask uses over a field reached through another type', () => {
  it('answers the uses a return type, a heritage clause and a class carry to the field', async () => {
    checkout({ ...PROPS, ...TYPES });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/lib\/src\/through\/props\.ts:2 — Props$/m);
    expect(section(out, '`Props.size`, declared at packages/lib/src/through/props.ts:2, is used in 9 places:')).toEqual([
      ...OWN,
      // A return type types the literal the function returns.
      'packages/lib/src/through/make.ts:3 — @acme/lib, write',
      'packages/lib/src/through/make.ts:5 — @acme/lib, write',
      // `this` inside a class that implements `Props`; a `function` inside it binds another `this`.
      'packages/lib/src/through/box.ts:5 — @acme/lib, read',
      // An interface or an intersection that carries `Props`, in its own file and through its import.
      'packages/lib/src/through/far.ts:2 — @acme/lib, read',
      'packages/lib/src/through/far.ts:3 — @acme/lib, read',
      'packages/lib/src/through/wide.ts:5 — @acme/lib, read',
    ].sort(byPath));
    expect(section(out, '`Box.size`, declared at packages/lib/src/through/box.ts:3, is used in 1 place:')).toEqual([
      'packages/lib/src/through/box.ts:5 — @acme/lib, read',
    ]);
    expect(section(out, '`Elsewhere.size`, declared at packages/lib/src/through/other.tsx:2, is used in 2 places:')).toEqual([
      'packages/lib/src/through/other.tsx:4 — @acme/lib, destructure',
      'packages/lib/src/through/other.tsx:5 — @acme/lib, write',
    ]);
    expect(section(out, '`Loose.size`, declared at packages/lib/src/through/other.tsx:7, is used in 1 place:')).toEqual([
      'packages/lib/src/through/other.tsx:9 — @acme/lib, read',
    ]);
  });

  it('answers the uses a component and the elements that render it carry to the field', async () => {
    checkout({ ...PROPS, ...COMPONENTS });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size']);
    expect(code).toBe(EXIT_CLEAN);
    expect(section(out, '`Props.size`, declared at packages/lib/src/through/props.ts:2, is used in 9 places:')).toEqual([
      // A component annotated `FC<Props>`, or whose first parameter is `Props`, takes its props as `Props`.
      'packages/lib/src/through/Button.tsx:4 — @acme/lib, destructure',
      'packages/lib/src/through/Button.tsx:5 — @acme/lib, read',
      'packages/lib/src/through/Button.tsx:7 — @acme/lib, read',
      // A JSX attribute writes the field of the props its component takes.
      'packages/lib/src/through/page.tsx:4 — @acme/lib, write',
      'packages/lib/src/through/page.tsx:5 — @acme/lib, write',
      'packages/lib/src/through/page.tsx:6 — @acme/lib, write',
      ...OWN,
    ].sort(byPath));
  });

  // A checker infers these; the source writes no `Props` at the site.
  it.todo('answers a use through a component wrapped in `memo` or `forwardRef` — needs the walker to read the props type off the wrapper\'s type argument or the wrapped function\'s first parameter, as it does for `FC<Props>`');
  it.todo('answers a use through a utility type over the field\'s type, `Partial<Props>` or `Pick<Props, "size">` — needs a carry for each of TypeScript\'s homomorphic utility types, with `Pick` and `Omit` carrying only the keys they keep');
  it.todo('answers `this.props.size` in a class component, `class Panel extends React.Component<Props>` — needs the class heritage to read a qualified base and carry its type argument as the type `this.props` is');
});

/** The answer's order: by path in code units, then by line. */
function byPath(a: string, b: string): number {
  const [pathA = '', lineA = '0'] = a.split(' — ')[0]!.split(':');
  const [pathB = '', lineB = '0'] = b.split(' — ')[0]!.split(':');
  return pathA < pathB ? -1 : pathA > pathB ? 1 : Number(lineA) - Number(lineB);
}
