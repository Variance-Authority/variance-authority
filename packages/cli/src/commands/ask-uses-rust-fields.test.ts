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

  it.todo(
    'answers a field read through a chain, `o.inner.size`, where the struct that declares `inner` is in another file — ' +
      'needs the declaration row to carry the type its field is annotated with, and the join to follow that type through the `use` that binds it',
  );

  it.todo(
    'answers a field used through a type a glob import brings in, `use crate::shapes::*;` then `p: &Props` and `p.size` — ' +
      'needs the join to look up an unbound head in the modules a file glob-imports, and to pick the one that declares it',
  );

  it.todo(
    'answers a field used through a module-qualified type, `p: &shapes::Props` or `shapes::Props { size: 1 }` — ' +
      'needs the reader to keep the path before the type name as the head, and the join to resolve that module path to its file',
  );
});
