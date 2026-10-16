import { describe, expect, it } from 'vitest';
import { native } from './native.js';
import type { Read } from './read.js';
import { isRustRelative, resolveRust } from './rust.js';
import { worldIn } from './world.js';

/**
 * The two certainties a Rust file offers, and the one it does not.
 *
 * `mod` declares a file and a missing one does not compile, so a `mod` that
 * resolves to nothing is a hole. `use` names an item, and which prefix of it is
 * a module is a fact about the disk rather than about the statement — so it is
 * guessed, and a `use` that finds nothing is an external crate rather than a
 * defect. Collapsing the two in either direction is the failure: every `use
 * std::fmt` becomes a missing file, or every deleted module becomes silence.
 */

describe('what a Rust file asks for', () => {
  it('declares a module as written fact and asks for an item as a guess', () => {
    const read = readRust('src/lib.rs', 'mod order;\nuse crate::read::Read;\n');
    const asked = new Map(read.requests.map((request) => [request.value, request]));

    expect(asked.get('self::order')?.guessed).toBeUndefined();
    expect(asked.get('crate::read::Read')?.guessed).toBe(true);
  });

  it('takes a declared module whole, as a namespace, and an item a `use` names by its name', () => {
    // `mod order;` imports no item `order`, though `order.rs` may declare one.
    const read = readRust('src/lib.rs', 'mod order;\nuse crate::order::order;\n');
    const taken = new Map(read.requests.map((request) => [request.value, request.bindings.map(({ imported, local }) => ({ imported, local }))]));

    expect(taken.get('self::order')).toEqual([{ imported: '*', local: 'order' }]);
    expect(taken.get('crate::order::order')).toEqual([{ imported: 'order', local: 'order' }]);
  });

  it('binds a glob as every item, apart from the module it names', () => {
    // `use crate::shapes::*` takes each item of `shapes` under its own name;
    // `use crate::shapes;` takes the module. The same request carries both.
    const read = readRust('src/lib.rs', 'use crate::shapes::*;\nuse crate::shapes;\nmod tests {\n    use super::*;\n}\n');
    const taken = new Map(read.requests.map((request) => [request.value, request.bindings.map(({ imported, local }) => ({ imported, local }))]));

    expect(taken.get('crate::shapes')).toEqual([{ imported: '*', local: '*' }, { imported: 'shapes', local: 'shapes' }]);
    // `super` from an inline module is this file: no glob of it is bound.
    expect(taken.get('super')).toEqual([{ imported: 'super', local: 'super' }]);
  });

  it('asks for what a path from the crate root names outside a `use`, as a `use` of its prefix would', () => {
    // `crate::shapes::Props` needs `crate::shapes`; `crate::shapes::Shape::Square`
    // needs the item `Shape` too. A path inside a `use` or a macro is not read here.
    const read = readRust('src/draw.rs', 'fn f(p: &crate::shapes::Props) {\n    let crate::shapes::Shape::Square { size } = s;\n    m!(crate::other::X);\n}\n');
    const taken = new Map(read.requests.map((request) => [request.value, request]));

    expect([...taken.keys()]).toEqual(['crate::shapes', 'crate::shapes::Shape']);
    expect(taken.get('crate::shapes')?.bindings.map(({ imported, local }) => ({ imported, local }))).toEqual([{ imported: 'shapes', local: 'crate::shapes' }]);
    expect(taken.get('crate::shapes::Shape')?.bindings.map(({ imported, local }) => ({ imported, local }))).toEqual([{ imported: 'Shape', local: 'crate::shapes::Shape' }]);
    expect(taken.get('crate::shapes')?.guessed).toBe(true);
  });

  it('carries an inline module down to the files declared inside it', () => {
    // `mod b;` inside `mod a { … }` is the file `a/b.rs`, and the nesting is
    // the only thing that says so.
    const read = readRust('src/lib.rs', 'mod a {\n    mod b;\n}\n');

    expect(read.requests.map((request) => request.value)).toEqual(['self::a::b']);
  });

  it('takes the filename `#[path]` spells instead of the module name', () => {
    const read = readRust('src/lib.rs', '#[path = "other/place.rs"]\nmod here;\n');

    expect(read.requests[0]?.value).toBe('other/place.rs');
    expect(read.requests[0]?.guessed).toBeUndefined();
  });

  it('keeps the written request when a guess names the same module', () => {
    const read = readRust('src/lib.rs', 'use self::order::Sort;\nmod order;\n');
    const asked = read.requests.filter((request) => request.value === 'self::order');

    // One file, one request, and the one that can be a hole is the one kept.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.guessed).toBeUndefined();
  });

  it('reads `self` in a list as the module, not as a name inside it', () => {
    const read = readRust('src/a.rs', 'use crate::git::{self, Oid};\n');

    expect(read.requests.map((request) => request.value))
      .toEqual(['crate::git', 'crate::git::Oid']);
  });

  it('publishes what is `pub`, and re-exports what is `pub use`', () => {
    const read = readRust('src/lib.rs', 'pub struct Lens;\nstruct Hidden;\npub use crate::read::Read;\n');
    const exported = new Map((read.exports ?? []).map((entry) => [entry.exported, entry]));

    expect([...exported.keys()]).toEqual(['Lens', 'Read']);
    expect(exported.get('Read')?.from).toBe('crate::read::Read');
  });

  it('publishes an item another file of its crate can name, and not one `pub(self)` keeps to its module', () => {
    const read = readRust(
      'src/lib.rs',
      'pub(crate) fn shared() {}\npub(super) struct Up;\npub(in crate::a) const A: u8 = 1;\npub(self) fn kept() {}\npub(in self) fn held() {}\npub(self) use crate::b::C;\n',
    );

    expect((read.exports ?? []).map((entry) => entry.exported)).toEqual(['shared', 'Up', 'A']);
    expect(read.symbols?.filter(({ name }) => name === 'kept' || name === 'held').map(({ reach }) => reach)).toEqual(['module', 'module']);
  });

  it('says so when the parser stopped where a `use` could have been', () => {
    expect(readRust('src/a.rs', 'use self::b::C;\n@ ~ !\n').unknown).toContain('did not parse cleanly');
  });

  it('reads a file whose only error is inside a body, rather than marking it unknown', () => {
    const read = readRust('src/a.rs', 'use self::b::C;\nfn held() { let ( ; }\n');

    expect(read.requests.map((request) => request.value)).toEqual(['self::b::C']);
    expect(read.unknown).toBeUndefined();
  });

  it('answers for a path this repository could own, and not for a foreign crate', () => {
    expect(isRustRelative('self::order')).toBe(true);
    expect(isRustRelative('crate::read::Read')).toBe(true);
    expect(isRustRelative('other/place.rs')).toBe(true);
    expect(isRustRelative('std::fmt::Display')).toBe(false);
  });
});

describe('what a Rust file declares', () => {
  it('records every top-level item, `pub` or not, with its signature and the doc above it, past its attributes', () => {
    const contents = [
      '/// Start again.',
      '/// In a process of its own.',
      '#[inline]',
      'fn relaunch(argv: &[String]) -> i32 {',
      '    0',
      '}',
      '',
      'pub struct Lens;',
      '',
      'const LIMIT: u32 = 5;',
      '',
      'mod inner {',
      '    fn hidden() {}',
      '}',
      '',
    ].join('\n');
    const read = readRust('src/lib.rs', contents);

    expect(spelled(contents, read)).toEqual([
      { name: 'relaunch', kind: 'function', line: 4, signature: 'fn relaunch(argv: &[String]) -> i32', doc: '/// Start again.\n/// In a process of its own.' },
      { name: 'Lens', kind: 'struct', line: 8, signature: 'pub struct Lens;', doc: undefined },
      { name: 'LIMIT', kind: 'const', line: 10, signature: 'const LIMIT: u32', doc: undefined },
      { name: 'inner', kind: 'module', line: 12, signature: 'mod inner', doc: undefined },
    ]);
  });

  it('says an item is its module\'s, and records no reach for a `macro_rules!`, which no visibility governs', () => {
    const read = readRust('src/lib.rs', 'fn relaunch() {}\n\n#[macro_export]\nmacro_rules! again {\n    () => {};\n}\n');
    expect(read.symbols?.map(({ name, kind, reach }) => ({ name, kind, reach }))).toEqual([
      { name: 'relaunch', kind: 'function', reach: 'module' },
      { name: 'again', kind: 'macro', reach: undefined },
    ]);
  });

  it('says a file that declares nothing was read for declarations, which a file it could not read was not', () => {
    const { symbols, harvested } = readRust('src/lib.rs', 'use crate::a::B;\n');
    expect({ symbols, harvested }).toEqual({ symbols: undefined, harvested: true });
  });
});

describe('where a Rust path lands', () => {
  const world = worldIn([
    'Cargo.toml',
    'src/lib.rs',
    'src/read.rs',
    'src/order/mod.rs',
    'src/order/sort.rs',
    'other/place.rs',
  ]);

  it('finds a module beside its declaration, and a directory by its own file', () => {
    expect(resolveRust({ from: 'src/lib.rs', request: 'self::read', world }))
      .toEqual(['src/read.rs']);
    expect(resolveRust({ from: 'src/lib.rs', request: 'self::order', world }))
      .toEqual(['src/order/mod.rs']);
  });

  it('takes the longest prefix of a `use` that is a file', () => {
    // `Sort` is a type in `order/sort.rs`, and nothing in the statement says
    // where the module stops and the item begins.
    expect(resolveRust({ from: 'src/lib.rs', request: 'crate::order::sort::Sort', world }))
      .toEqual(['src/order/sort.rs']);
  });

  it('climbs with `super` to the module a file sits in, and reaches its siblings', () => {
    // `src/order/sort.rs` is the module `order::sort`, so its parent is
    // `order` — the directory's own file, not the directory.
    expect(resolveRust({ from: 'src/order/sort.rs', request: 'super', world }))
      .toEqual(['src/order/mod.rs']);
    expect(resolveRust({ from: 'src/order/sort.rs', request: 'super::sort::Sort', world }))
      .toEqual(['src/order/sort.rs']);
  });

  it('takes a spelled path as a path, relative to the declaring file', () => {
    expect(resolveRust({ from: 'src/lib.rs', request: 'other/place.rs', world }))
      .toEqual([]);
  });

  it('is silent about a crate this tree does not hold', () => {
    expect(resolveRust({ from: 'src/lib.rs', request: 'serde::Deserialize', world }))
      .toEqual([]);
  });
});


/** A symbol's signature and doc, as the spans it carries cut them from `contents`. */
function spelled(contents: string, read: Read) {
  const cut = (span: { readonly start: number; readonly end: number } | undefined) => span && contents.slice(span.start, span.end);
  return (read.symbols ?? []).map(({ name, kind, line, signature, doc }) => ({ name, kind, line, signature: cut(signature), doc: cut(doc) }));
}

/** What the addon's Rust reader answers, which is the only reader there is. */
function readRust(file: string, contents: string): Read {
  const answer = native()?.readLanguage('rust', file, contents);
  if (answer == null) throw new Error('these tests read Rust through the native addon, built with its grammars');
  return JSON.parse(answer) as Read;
}
