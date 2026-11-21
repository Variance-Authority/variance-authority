import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/core/relate';
import type { ParseCache, ParseKey, Parsed } from './cache.js';
import { keyFor, parseWay } from './files.js';
import { scanRelations } from './test-support/scan.js';

/**
 * One scan, one record space, one graph — over five languages at once.
 *
 * A language is a reader and a resolution algorithm and nothing above the
 * record learns a new type
 * ([ADR-0066](../../../docs/context/adr/0066-a-language-is-a-reader-not-a-sense.md)).
 * What that has to mean in practice is this: a repository holding JavaScript,
 * Python, Rust, Java and Swift produces one pile of records the fold walks
 * without being told which reader made which, and a file in any of them is
 * reached by the same traversal.
 */

describe('a repository of five languages, scanned once', () => {
  let root: string;
  let records: readonly FileRecord[];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-many-'));

    await write(root, 'package.json', '{ "name": "fixture" }');
    await write(root, 'app/index.js', "import './lens.js';\n");
    await write(root, 'app/lens.js', 'export const lens = 1;\n');

    await write(root, 'py/pyproject.toml', '[project]\nname = "fixture"\n');
    await write(root, 'py/src/pkg/__init__.py', '');
    await write(root, 'py/src/pkg/read.py', 'from . import lens\n');
    await write(root, 'py/src/pkg/lens.py', 'VERSION = 1\n');

    await write(root, 'rs/Cargo.toml', '[package]\nname = "held"\n');
    await write(root, 'rs/src/lib.rs', 'mod lens;\nuse std::fmt;\n');
    await write(root, 'rs/src/lens.rs', 'pub struct Lens;\n');

    await write(root, 'jv/src/main/java/a/b/Thing.java', 'package a.b;\nimport java.util.List;\nclass Thing {}\n');
    await write(root, 'jv/src/main/java/a/b/Other.java', 'package a.b;\nclass Other {}\n');

    await write(root, 'sw/Package.swift', [
      'import PackageDescription',
      'let package = Package(name: "Fixture", targets: [.target(name: "Core")])',
    ].join('\n'));
    await write(root, 'sw/Sources/Core/Lens.swift', 'import Foundation\nstruct Lens {}\n');
    await write(root, 'sw/Sources/Core/Seen.swift', 'struct Seen {}\n');

    records = await scanRelations({ root, dirs: ['.'], digests: false });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const edgesOf = (file: string): readonly string[] =>
    (records.find((record) => record.file === file)?.edges ?? []).map((edge) => edge.to);

  it('reads every language into the one record space', () => {
    expect(edgesOf('app/index.js')).toEqual(['app/lens.js']);
    expect(edgesOf('py/src/pkg/read.py')).toEqual(['py/src/pkg/__init__.py', 'py/src/pkg/lens.py']);
    expect(edgesOf('rs/src/lib.rs')).toEqual(['rs/src/lens.rs']);
    expect(edgesOf('jv/src/main/java/a/b/Thing.java')).toEqual(['jv/src/main/java/a/b/Other.java']);
    // Neither Swift file imports the other; they are in one target, which is
    // the only grain the language has.
    expect(edgesOf('sw/Sources/Core/Lens.swift')).toEqual(['sw/Sources/Core/Seen.swift']);
  });

  it('reports no hole for the platform every one of them imports', () => {
    // `std::fmt`, `java.util.List` and `Foundation` are dependencies, not
    // missing files, and the reader marks them guessed so a miss is silence.
    for (const record of records) {
      expect(record.unresolved ?? []).toEqual([]);
      expect(record.unknown).toBeUndefined();
    }
  });

  it('draws code edges throughout, so a code-only traversal sees all five', () => {
    for (const record of records) {
      for (const edge of record.edges ?? []) expect(edge.kind).toBe('imports');
    }
  });

  it('stores bytes and lines for a file of every language, and a region count only for the module', async () => {
    const held = new Map<ParseKey, Parsed>();
    const cache: ParseCache = { get: () => undefined, set: (key, parsed) => void held.set(key, parsed) };
    const digested = await scanRelations({ root, dirs: ['.'], cache });
    const sizeOf = (file: string) => {
      const digest = digested.find((record) => record.file === file)?.digest;
      return digest === undefined ? undefined : held.get(keyFor(digest, parseWay(file)))?.size;
    };

    expect(sizeOf('app/lens.js')).toEqual({ bytes: 23, lines: 1, blocks: 1 });
    expect(sizeOf('py/src/pkg/read.py')).toEqual({ bytes: 19, lines: 1 });
    expect(sizeOf('rs/src/lib.rs')).toEqual({ bytes: 24, lines: 2 });
    expect(sizeOf('jv/src/main/java/a/b/Thing.java')).toEqual({ bytes: 51, lines: 3 });
    expect(sizeOf('sw/Sources/Core/Lens.swift')).toEqual({ bytes: 33, lines: 2 });
  });
});

describe('a Rust crate whose paths climb the module tree', () => {
  it('lands a `super` and a `crate` path on the file whose `mod` lines declare them', async () => {
    // That a neighbour the batch read is not read again is `held_first` in
    // `native/src/batch.rs`, asserted there: the parse count does not cross N-API.
    const root = await mkdtemp(join(tmpdir(), 'variance-rust-once-'));
    await write(root, 'Cargo.toml', '[package]\nname = "held"\n');
    await write(root, 'src/lib.rs', 'mod lens;\nmod view;\nstruct Lens;\n');
    await write(root, 'src/lens.rs', 'use super::Lens;\n');
    await write(root, 'src/view.rs', 'fn draw(lens: crate::Lens) {}\n');
    try {
      const records = await scanRelations({ root, dirs: ['.'] });
      const edgesTo = (file: string) => records.find((record) => record.file === file)?.edges?.map((edge) => edge.to);

      expect(edgesTo('src/lens.rs')).toEqual(['src/lib.rs']);
      expect(edgesTo('src/view.rs')).toEqual(['src/lib.rs']);
      expect(edgesTo('src/lib.rs')).toEqual(['src/lens.rs', 'src/view.rs']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('two files holding the same bytes', () => {
  // A parse is keyed by its bytes and shared by every file holding them, so it
  // names none of them; the record is where a file is named, once (#1499).
  const sources: Readonly<Record<string, string>> = {
    'gyp/__init__.py': 'mod = __import__(name)\n',
    'src/a.rs': 'use self::b::C;\n@ ~ !\n',
    'a/Thing.java': 'import a.B;\n@ ~ !\n',
    'a/Thing.kt': 'import a.B\n@ ~ !\n',
    'Sources/Core/a.swift': 'import Core\n@ ~ !\n',
  };

  it('names each file once in its own record, and neither in the parse they share', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-twins-'));
    for (const [path, contents] of Object.entries(sources)) {
      await write(root, `one/${path}`, contents);
      await write(root, `two/${path}`, contents);
    }
    const held = new Map<ParseKey, Parsed>();
    const cache: ParseCache = { get: () => undefined, set: (key, parsed) => void held.set(key, parsed) };
    try {
      const records = await scanRelations({ root, dirs: ['.'], cache });
      const unknownOf = (file: string) => records.find((record) => record.file === file)?.unknown;

      expect(unknownOf('one/gyp/__init__.py')).toBe('one/gyp/__init__.py — __import__(…) on line 1 names a module this cannot read');
      expect(unknownOf('two/gyp/__init__.py')).toBe('two/gyp/__init__.py — __import__(…) on line 1 names a module this cannot read');
      for (const path of Object.keys(sources)) {
        for (const [own, other] of [['one', 'two'], ['two', 'one']] as const) {
          const unknown = unknownOf(`${own}/${path}`) ?? '';
          expect(unknown.startsWith(`${own}/${path} — `)).toBe(true);
          expect(unknown.split(`${own}/`)).toHaveLength(2);
          expect(unknown).not.toContain(`${other}/`);
        }
      }
      const stored = [...held.values()].map((parsed) => parsed.unknown).filter((unknown) => unknown !== undefined);
      expect(stored).toHaveLength(Object.keys(sources).length);
      for (const unknown of stored) expect(unknown).not.toMatch(/(one|two)\//);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}
