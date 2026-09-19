import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/core/relate';
import { scanRelations } from './scan.js';

/**
 * One scan, one record space, one graph — over five languages at once.
 *
 * A language is a reader and a resolution algorithm and nothing above
 * [`record.ts`](./record.ts) learns a new type
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
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}
