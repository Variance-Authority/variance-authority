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

  it('reads `self` and `super` inside an inline module from that module, not from the file', () => {
    // In `foo.rs`, `super` inside `mod tests` is `foo` itself, and a glob of it
    // names the file it is written in, which is no edge.
    const read = readRust('src/foo.rs', 'mod tests {\n    use super::*;\n    use super::helper;\n    use self::fixture::Fixture;\n    use crate::bar::Bar;\n}\n');

    expect(read.requests.map((request) => request.value))
      .toEqual(['self::helper', 'self::tests::fixture::Fixture', 'crate::bar::Bar']);
  });

  it('climbs nested inline modules one `super` at a time, and past them to the file\'s parent', () => {
    const read = readRust(
      'src/foo.rs',
      'mod a {\n    mod b {\n        use super::c::C;\n        use super::super::d::D;\n        use super::super::super::sibling::S;\n    }\n}\n',
    );

    expect(read.requests.map((request) => request.value))
      .toEqual(['self::a::c::C', 'self::d::D', 'super::sibling::S']);
  });

  it('reads a `#[path]` inside an inline module as a file of that module', () => {
    // The Rust Reference: inside `mod inline { … }` the path starts at the
    // inline module's directory. The reader names the module, and leaves which
    // directory it has to the resolver.
    const inside = '#[path = "elsewhere.rs"]\nmod beside;\nmod inline {\n    #[path = "other.rs"]\n    mod inner;\n    mod deeper {\n        #[path = "../up.rs"]\n        mod up;\n    }\n}\n';

    expect(readRust('src/a/b.rs', inside).requests.map((request) => request.value))
      .toEqual(['elsewhere.rs', 'self::inline/other.rs', 'self::inline::deeper/../up.rs']);
  });

  // The Reference's table: `#[path = "foo"] mod inline { mod inner; }` in
  // `a/b.rs` puts `inner` at `a/b/foo/inner.rs`. The reader carries the inline
  // module's name as the directory, so it asks for `a/b/inline/inner.rs`.
  it.todo('reads the directory a `#[path]` on an inline module gives the modules declared inside it — needs the reader to carry a directory path beside the module path');

  it('re-exports only what a `pub use` at the top of the file publishes', () => {
    // `pub use` inside `mod inner` publishes `inner::B`, not a `B` of the file.
    const read = readRust('src/lib.rs', 'pub use crate::a::A;\nmod inner {\n    pub use crate::b::B;\n}\n');

    expect((read.exports ?? []).map((entry) => entry.exported)).toEqual(['A']);
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
  it('records every item, `pub` or not, with its signature and the doc above it, past its attributes, and one in an inline module on its module path', () => {
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
      { name: 'inner::hidden', kind: 'function', line: 13, signature: 'fn hidden()', doc: undefined },
    ]);
  });

  it('declares what nested inline modules hold on the path through them, and says who can name it only when it is not `pub`', () => {
    const contents = 'pub mod a {\n    pub struct Open;\n    mod b {\n        /// Shown.\n        pub fn deep() {}\n        fn deeper() {}\n    }\n}\nmod tests {\n    use super::*;\n    fn fixture() {}\n    macro_rules! check {\n        () => {};\n    }\n}\n';
    const read = readRust('src/foo.rs', contents);

    // `pub` inside a private inline module reaches as far as the modules
    // around it let it, which the item alone does not say. `a::Open` is `pub`
    // all the way up: the file exports `a`, and it is named through that. A
    // `macro_rules!` has no module path: it is in scope by where it is written.
    expect(read.symbols?.map(({ name, kind, line, reach }) => ({ name, kind, line, reach }))).toEqual([
      { name: 'a', kind: 'module', line: 1, reach: 'module' },
      { name: 'a::b', kind: 'module', line: 3, reach: 'module' },
      { name: 'a::b::deep', kind: 'function', line: 5, reach: undefined },
      { name: 'a::b::deeper', kind: 'function', line: 6, reach: 'module' },
      { name: 'tests', kind: 'module', line: 9, reach: 'module' },
      { name: 'tests::fixture', kind: 'function', line: 11, reach: 'module' },
      { name: 'check', kind: 'macro', line: 12, reach: undefined },
    ]);
    expect(spelled(contents, read)[2]?.doc).toBe('/// Shown.');
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

  it('climbs with `super` to the module a file sits in', () => {
    // `src/order/sort.rs` is the module `order::sort`, so its parent is
    // `order` — the directory's own file, not the directory.
    expect(resolveRust({ from: 'src/order/sort.rs', request: 'super', world }))
      .toEqual(['src/order/mod.rs']);
  });

  it('never lands on the file that asks, which is no edge', () => {
    // `use super::helper` in a `mod tests` of `lib.rs` names an item of
    // `lib.rs` itself, and `super::sort::Sort` from `sort.rs` names `sort.rs`.
    expect(resolveRust({ from: 'src/lib.rs', request: 'self::helper', world })).toEqual([]);
    expect(resolveRust({ from: 'src/order/sort.rs', request: 'super::sort::Sort', world }))
      .toEqual([]);
  });

  it('lands an inline module\'s `super` on the file that holds the module, never on the crate root', () => {
    const tree = worldIn(['Cargo.toml', 'src/lib.rs', 'src/foo.rs', 'src/bar.rs']);
    const read = readRust('src/foo.rs', 'mod tests {\n    use super::*;\n    use super::helper;\n    use super::super::bar::Bar;\n}\n');

    expect(read.requests.flatMap(({ value }) => resolveRust({ from: 'src/foo.rs', request: value, world: tree })))
      .toEqual(['src/bar.rs']);
  });

  it('lands a `#[path]` inside an inline module under that module\'s directory', () => {
    const tree = worldIn(['Cargo.toml', 'src/lib.rs', 'src/a.rs', 'src/a/b.rs', 'src/a/b/inline/other.rs', 'src/a/elsewhere.rs']);
    const read = readRust('src/a/b.rs', '#[path = "elsewhere.rs"]\nmod beside;\nmod inline {\n    #[path = "other.rs"]\n    mod inner;\n}\n');

    expect(read.requests.flatMap(({ value }) => resolveRust({ from: 'src/a/b.rs', request: value, world: tree })))
      .toEqual(['src/a/elsewhere.rs', 'src/a/b/inline/other.rs']);
    // A `mod.rs` owns the directory it is in, so its inline modules sit there.
    const owned = worldIn(['Cargo.toml', 'src/lib.rs', 'src/a/mod.rs', 'src/a/inline/other.rs', 'src/a/elsewhere.rs']);
    const inMod = readRust('src/a/mod.rs', '#[path = "elsewhere.rs"]\nmod beside;\nmod inline {\n    #[path = "other.rs"]\n    mod inner;\n}\n');

    expect(inMod.requests.flatMap(({ value }) => resolveRust({ from: 'src/a/mod.rs', request: value, world: owned })))
      .toEqual(['src/a/elsewhere.rs', 'src/a/inline/other.rs']);
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
