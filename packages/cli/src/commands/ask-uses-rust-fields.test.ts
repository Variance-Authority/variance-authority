import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` and `variance ask search` over a field of a Rust struct
 * and a variant of a Rust enum. No type checker runs, so a use is tied to a
 * declaration where the line names the type: a struct literal or a struct
 * pattern writes it, `self` and `Self` are the type of the `impl` around them,
 * and a parameter or a `let` is the type it is annotated with. That name is
 * followed through the `use` that binds it to the file that declares it, so
 * `Props::size` and `Other::size` are told apart, and a field reached through a field, `self.shown.size`, is the type the file declares that field as.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-rust-fields-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const CRATE = {
  'packages/kit/Cargo.toml': '[package]\nname = "kit"\nversion = "0.1.0"\n',
  'packages/kit/src/lib.rs': 'mod draw;\nmod shapes;\n',
  'packages/kit/src/shapes.rs': [
    'pub struct Props {',
    '    pub size: u32,',
    '    pub label: String,',
    '}',
    '',
    'pub struct Other {',
    '    pub size: i64,',
    '}',
    '',
    'pub enum Shape {',
    '    Dot,',
    '    Square { size: u32 },',
    '}',
    '',
    'impl Props {',
    '    pub fn grow(&mut self) {',
    '        self.size += 2;',
    '    }',
    '    pub fn fresh() -> Self {',
    '        Self { size: 1, label: String::new() }',
    '    }',
    '}',
    '',
    'impl Shape {',
    '    pub fn dot() -> Self {',
    '        Self::Dot',
    '    }',
    '}',
    '',
    'impl Props {',
    '    pub fn size(&self) -> u32 {',
    '        self.size',
    '    }',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/draw.rs': [
    'use crate::shapes::{Other, Props as Shown, Shape};',
    '',
    'pub fn area(props: &Shown) -> u32 {',
    '    props.size * props.size',
    '}',
    '',
    'pub fn shout(o: Other) -> i64 {',
    '    o.size',
    '}',
    '',
    'pub fn split(props: Shown) -> u32 {',
    '    let Shown { size, .. } = props;',
    '    size',
    '}',
    '',
    'pub fn make() -> Shown {',
    '    let size = 3;',
    '    Shown { size, label: String::new() }',
    '}',
    '',
    'pub fn shadow(props: &Shown) -> Vec<u32> {',
    '    [(1u32,)].iter().map(|props| props.size).collect()',
    '}',
    '',
    'pub fn side(shape: &Shape) -> u32 {',
    '    match shape {',
    '        Shape::Dot => 0,',
    '        Shape::Square { size } => *size,',
    '    }',
    '}',
    '',
    'pub fn checked(props: &Shown) -> bool {',
    '    assert!(props.size > 0);',
    '    props.label.is_empty()',
    '}',
    '',
    'pub fn sizes(all: &[Shown]) -> Vec<u32> {',
    '    all.iter().map(Shown::size).collect()',
    '}',
    '',
    'pub struct Panel {',
    '    pub shown: Shown,',
    '}',
    '',
    'impl Panel {',
    '    pub fn width(&self) -> u32 {',
    '        self.shown.size',
    '    }',
    '}',
    '',
    '#[cfg(test)]',
    'mod tests {',
    '    use super::*;',
    '',
    '    fn wide(props: &Shown) -> bool {',
    '        props.size > 9',
    '    }',
    '}',
    '',
  ].join('\n'),
};

/** Every line of an answer. */
function lines(out: string): string[] {
  return out.split('\n');
}

/** The heading of the section a line is listed under. */
function headed(out: string, at: string): string | undefined {
  let heading: string | undefined;
  for (const line of lines(out)) {
    if (line.startsWith('`')) heading = line;
    if (line.startsWith(`${at} `)) return heading;
  }
  return undefined;
}

/**
 * The crate again, with the files that reach `Props` past one `use` of its
 * name: a glob, a module path, and a field of a struct another file declares.
 */
const NESTED = {
  ...CRATE,
  'packages/kit/src/lib.rs': [
    'mod draw;',
    'mod glob;',
    'mod nest;',
    'mod outer;',
    'mod qualified;',
    'mod shapes;',
    '',
    'pub fn other(o: &shapes::Other) -> i64 {',
    '    o.size',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/glob.rs': ['use crate::shapes::*;', '', 'pub fn wide(p: &Props) -> u32 {', '    p.size', '}', ''].join('\n'),
  'packages/kit/src/outer.rs': [
    'use crate::shapes::Props;',
    '',
    'pub struct Outer {',
    '    pub inner: Props,',
    '}',
    '',
    'pub struct Deep {',
    '    pub outer: Box<Outer>,',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/nest.rs': [
    'use crate::outer::{Deep, Outer as Wrap};',
    '',
    'pub fn near(o: &Wrap) -> u32 {',
    '    o.inner.size',
    '}',
    '',
    'pub fn far(d: Deep) -> u32 {',
    '    d.outer.inner.size',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/qualified.rs': [
    'use crate::shapes;',
    '',
    'pub fn tall(p: &shapes::Props) -> u32 {',
    '    p.size',
    '}',
    '',
    'pub fn build() -> shapes::Props {',
    '    shapes::Props { size: 1, label: String::new() }',
    '}',
    '',
    'pub fn fresh() -> u32 {',
    '    let p = shapes::Props { size: 2, label: String::new() };',
    '    p.size',
    '}',
    '',
    'pub fn edge(s: &shapes::Shape) -> u32 {',
    '    match s {',
    '        shapes::Shape::Square { size } => *size,',
    '        _ => 0,',
    '    }',
    '}',
    '',
  ].join('\n'),
};

/**
 * The nested crate, with a file that spells each type from the crate root, a
 * file that reads a chain inside a macro, a file whose own `Props` shadows the
 * one its glob brings in, and a file with two inline modules that each declare
 * a `Props`.
 */
const ROOTED = {
  ...NESTED,
  'packages/kit/src/lib.rs': NESTED['packages/kit/src/lib.rs'].replace('mod qualified;', 'mod checked;\nmod inline;\nmod own;\nmod qualified;\nmod rooted;'),
  'packages/kit/src/rooted.rs': [
    'pub fn tall(p: &crate::shapes::Props) -> u32 {',
    '    p.size',
    '}',
    '',
    'pub fn build() -> crate::shapes::Props {',
    '    crate::shapes::Props { size: 1, label: String::new() }',
    '}',
    '',
    'pub fn edge(s: &crate::shapes::Shape) -> u32 {',
    '    match s {',
    '        crate::shapes::Shape::Square { size } => *size,',
    '        _ => 0,',
    '    }',
    '}',
    '',
    'pub fn deep(p: &crate::inline::a::Props) -> u8 {',
    '    p.size',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/checked.rs': [
    'use crate::outer::Outer;',
    '',
    'pub fn checked(o: &Outer) {',
    '    assert!(o.inner.size > 0);',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/own.rs': [
    'use crate::shapes::*;',
    '',
    'pub struct Props {',
    '    pub size: u8,',
    '}',
    '',
    'pub fn mine(p: &Props) -> u8 {',
    '    p.size',
    '}',
    '',
  ].join('\n'),
  'packages/kit/src/inline.rs': [
    'pub mod a {',
    '    pub struct Props {',
    '        pub size: u8,',
    '    }',
    '',
    '    pub fn near(p: &Props) -> u8 {',
    '        p.size',
    '    }',
    '}',
    '',
    'mod b {',
    '    pub struct Props {',
    '        pub size: u16,',
    '    }',
    '',
    '    pub fn near(p: &Props) -> u16 {',
    '        p.size',
    '    }',
    '}',
    '',
    'pub fn far(p: &a::Props) -> u8 {',
    '    p.size',
    '}',
    '',
  ].join('\n'),
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

describe('variance ask over a field or a variant of a Rust type', () => {
  it('answers `uses` for a struct field with the lines that read, write or destructure it, apart from a same-named field', async () => {
    checkout(CRATE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('`size` is no exported name; it is a member, declared in 3 places:');
    expect(out).toMatch(/^packages\/kit\/src\/shapes\.rs:2 — Props$/m);
    expect(out).toMatch(/^packages\/kit\/src\/shapes\.rs:7 — Other$/m);
    expect(out).toMatch(/^packages\/kit\/src\/shapes\.rs:12 — Shape::Square$/m);

    // `Shown::size` at draw.rs:38 is the method `size`, which a path names
    // where the field is reached by `.`, so it is no use of the field.
    expect(section(out, '`Props::size`, declared at packages/kit/src/shapes.rs:2, is used in 9 places:')).toEqual([
      'packages/kit/src/draw.rs:4 — @acme/kit, read',
      'packages/kit/src/draw.rs:12 — @acme/kit, destructure',
      'packages/kit/src/draw.rs:18 — @acme/kit, write',
      'packages/kit/src/draw.rs:33 — @acme/kit, read',
      'packages/kit/src/draw.rs:47 — @acme/kit, read',
      'packages/kit/src/draw.rs:56 — @acme/kit, read',
      'packages/kit/src/shapes.rs:17 — @acme/kit, write',
      'packages/kit/src/shapes.rs:20 — @acme/kit, write',
      'packages/kit/src/shapes.rs:32 — @acme/kit, read',
    ]);
    expect(section(out, '`Other::size`, declared at packages/kit/src/shapes.rs:7, is used in 1 place:')).toEqual([
      'packages/kit/src/draw.rs:8 — @acme/kit, read',
    ]);
    expect(section(out, '`Shape::Square::size`, declared at packages/kit/src/shapes.rs:12, is used in 1 place:')).toEqual([
      'packages/kit/src/draw.rs:28 — @acme/kit, destructure',
    ]);
  });

  it('answers `uses` for an enum variant with the lines that build it or match it', async () => {
    checkout(CRATE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'Dot']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/kit\/src\/shapes\.rs:11 — Shape$/m);
    expect(section(out, '`Shape::Dot`, declared at packages/kit/src/shapes.rs:11, is used in 2 places:')).toEqual([
      'packages/kit/src/draw.rs:27 — @acme/kit, destructure',
      'packages/kit/src/shapes.rs:26 — @acme/kit, write',
    ]);
  });

  it('answers `search` with the fields and variants whose names hold the words', async () => {
    checkout(CRATE);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'search', '--query', 'squar']);
    expect(code).toBe(EXIT_CLEAN);
    expect(section(out, '1 more name is declared as a member somewhere in the repository:')).toEqual([
      'Square — on Shape — @acme/kit · packages/kit/src/shapes.rs:12',
    ]);

    const label = await run(['ask', 'search', '--query', 'label']);
    expect(section(label.out, '1 more name is declared as a member somewhere in the repository:')).toEqual([
      'label — on Props — @acme/kit · packages/kit/src/shapes.rs:3',
    ]);

    const json = await run(['ask', 'search', '--query', 'squar', '--format', 'json']);
    expect(JSON.parse(json.out).members).toEqual({
      total: 1,
      shown: [{ source: 'member', name: 'Square', on: 'Shape', package: '@acme/kit', at: 'packages/kit/src/shapes.rs', line: 12 }],
    });
  });

  it('answers a field read through a chain whose struct another file declares, `o.inner.size`, by the type that file annotates the field with', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size', '--from', 'packages/kit/src/nest.rs']);
    expect(code).toBe(EXIT_CLEAN);
    const props = section(out, '`Props::size`, declared at packages/kit/src/shapes.rs:2, is used in 16 places:');
    expect(props.filter((line) => line.startsWith('packages/kit/src/nest.rs'))).toEqual([
      'packages/kit/src/nest.rs:4 — @acme/kit, read',
      'packages/kit/src/nest.rs:8 — @acme/kit, read',
    ]);

    const inner = await run(['ask', 'uses', '--name', 'inner']);
    expect(section(inner.out, '`Outer::inner`, declared at packages/kit/src/outer.rs:4, is used in 2 places:')).toEqual([
      'packages/kit/src/nest.rs:4 — @acme/kit, read',
      'packages/kit/src/nest.rs:8 — @acme/kit, read',
    ]);
  });

  it('answers a field used through a type a glob import brings in, `use crate::shapes::*;` then `p.size`', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size', '--from', 'packages/kit/src/glob.rs']);
    expect(code).toBe(EXIT_CLEAN);
    const props = section(out, '`Props::size`, declared at packages/kit/src/shapes.rs:2, is used in 16 places:');
    expect(props.filter((line) => line.startsWith('packages/kit/src/glob.rs'))).toEqual(['packages/kit/src/glob.rs:4 — @acme/kit, read']);
  });

  it('answers a field used through a module-qualified type, `p: &shapes::Props` and `shapes::Props { size: 1 }`', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size', '--from', 'packages/kit/src/qualified.rs']);
    expect(code).toBe(EXIT_CLEAN);
    const props = section(out, '`Props::size`, declared at packages/kit/src/shapes.rs:2, is used in 16 places:');
    expect(props.filter((line) => line.startsWith('packages/kit/src/qualified.rs'))).toEqual([
      'packages/kit/src/qualified.rs:4 — @acme/kit, read',
      'packages/kit/src/qualified.rs:8 — @acme/kit, write',
      'packages/kit/src/qualified.rs:12 — @acme/kit, write',
      'packages/kit/src/qualified.rs:13 — @acme/kit, read',
    ]);
    // `mod shapes;` binds the module in the crate root, as `use crate::shapes;` does in a file.
    expect(section(out, '`Other::size`, declared at packages/kit/src/shapes.rs:7, is used in 2 places:')).toEqual([
      'packages/kit/src/draw.rs:8 — @acme/kit, read',
      'packages/kit/src/lib.rs:9 — @acme/kit, read',
    ]);
    expect(section(out, '`Shape::Square::size`, declared at packages/kit/src/shapes.rs:12, is used in 2 places:')).toEqual([
      // Nearest `--from` first.
      'packages/kit/src/qualified.rs:18 — @acme/kit, destructure',
      'packages/kit/src/draw.rs:28 — @acme/kit, destructure',
    ]);

    const square = await run(['ask', 'uses', '--name', 'Square']);
    expect(section(square.out, '`Shape::Square`, declared at packages/kit/src/shapes.rs:12, is used in 2 places:')).toEqual([
      'packages/kit/src/draw.rs:28 — @acme/kit, destructure',
      'packages/kit/src/qualified.rs:18 — @acme/kit, destructure',
    ]);
  });

  it('answers a field used through a type spelled from the crate root, `p: &crate::shapes::Props`', async () => {
    checkout(ROOTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size', '--from', 'packages/kit/src/rooted.rs']);
    expect(code).toBe(EXIT_CLEAN);
    const props = lines(out).filter((line) => line.startsWith('packages/kit/src/rooted.rs'));
    // `a::Props` is declared in inline.rs, which sorts before shapes.rs.
    expect(props).toEqual([
      'packages/kit/src/rooted.rs:17 — @acme/kit, read',
      'packages/kit/src/rooted.rs:2 — @acme/kit, read',
      'packages/kit/src/rooted.rs:6 — @acme/kit, write',
      'packages/kit/src/rooted.rs:11 — @acme/kit, destructure',
    ]);
    expect(headed(out, 'packages/kit/src/rooted.rs:2')).toMatch(/^`Props::size`, declared at packages\/kit\/src\/shapes.rs:2/);
    expect(headed(out, 'packages/kit/src/rooted.rs:11')).toMatch(/^`Shape::Square::size`, declared at packages\/kit\/src\/shapes.rs:12/);
    // A path through an inline module of another file reaches the struct inside it.
    expect(headed(out, 'packages/kit/src/rooted.rs:17')).toMatch(/^`a::Props::size`, declared at packages\/kit\/src\/inline.rs:3/);
  });

  it('answers a field read through a chain inside a macro\'s tokens, `assert!(o.inner.size > 0)`', async () => {
    checkout(ROOTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size', '--from', 'packages/kit/src/checked.rs']);
    expect(code).toBe(EXIT_CLEAN);
    expect(lines(out).filter((line) => line.startsWith('packages/kit/src/checked.rs'))).toEqual(['packages/kit/src/checked.rs:4 — @acme/kit, read']);
    expect(headed(out, 'packages/kit/src/checked.rs:4')).toMatch(/^`Props::size`, declared at packages\/kit\/src\/shapes.rs:2/);

    const inner = await run(['ask', 'uses', '--name', 'inner', '--from', 'packages/kit/src/checked.rs']);
    expect(headed(inner.out, 'packages/kit/src/checked.rs:4')).toMatch(/^`Outer::inner`, declared at packages\/kit\/src\/outer.rs:4/);
  });

  it('answers a field of a struct the file declares itself on that struct alone, past a glob that brings in a namesake', async () => {
    checkout(ROOTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size', '--from', 'packages/kit/src/own.rs']);
    expect(code).toBe(EXIT_CLEAN);
    // The declaration list names own.rs:4 too; a use carries its package.
    expect(lines(out).filter((line) => line.startsWith('packages/kit/src/own.rs:') && line.includes(' — @acme/kit, '))).toEqual(['packages/kit/src/own.rs:8 — @acme/kit, read']);
    expect(headed(out, 'packages/kit/src/own.rs:8')).toMatch(/^`Props::size`, declared at packages\/kit\/src\/own.rs:4/);
  });

  it('answers each of two same-named structs in two inline modules apart', async () => {
    checkout(ROOTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'size', '--from', 'packages/kit/src/inline.rs']);
    expect(code).toBe(EXIT_CLEAN);
    expect(section(out, '`a::Props::size`, declared at packages/kit/src/inline.rs:3, is used in 3 places:')).toEqual([
      'packages/kit/src/inline.rs:7 — @acme/kit, read',
      'packages/kit/src/inline.rs:22 — @acme/kit, read',
      'packages/kit/src/rooted.rs:17 — @acme/kit, read',
    ]);
    expect(section(out, '`b::Props::size`, declared at packages/kit/src/inline.rs:13, is used in 1 place:')).toEqual([
      'packages/kit/src/inline.rs:17 — @acme/kit, read',
    ]);
  });
});
