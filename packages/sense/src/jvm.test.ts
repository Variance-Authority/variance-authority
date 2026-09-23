import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGrammars } from './grammar.js';
import { readJava, readKotlin, resolveJvm } from './jvm.js';
import { worldOn, type TreeWorld } from './world.js';

/**
 * Two syntaxes over one resolution algorithm.
 *
 * Nothing in a JVM import separates this repository's packages from the
 * platform's, so every request is a guess and a miss is silence. What a file
 * does say for certain is its own package, and the edges that come from it are
 * the majority of a JVM codebase's real ones: two classes in one package see
 * each other with no import at all, and a reader that only reads `import`
 * statements reports them as unrelated.
 */

describe('what a JVM file asks for', () => {
  beforeAll(async () => {
    await loadGrammars();
  });

  it('asks for its own package, which nothing in the file imports', () => {
    const java = readJava('Thing.java', 'package a.b;\nclass Thing {}\n');
    const kotlin = readKotlin('thing.kt', 'package a.b\n\nclass Thing\n');

    expect(java.requests[0]?.value).toBe('a.b.*');
    expect(kotlin.requests[0]?.value).toBe('a.b.*');
  });

  it('marks every import a guess, because the syntax cannot say whose it is', () => {
    const read = readJava('Thing.java', 'package a.b;\nimport java.util.List;\nimport a.c.Other;\nclass Thing {}\n');

    expect(read.requests.every((request) => request.guessed === true)).toBe(true);
  });

  it('reads a wildcard import as the package rather than as a name', () => {
    const read = readJava('Thing.java', 'import a.c.*;\nclass Thing {}\n');

    expect(read.requests.map((request) => request.value)).toEqual(['a.c.*']);
  });

  it('binds a Kotlin import under its alias', () => {
    const read = readKotlin('t.kt', 'import a.c.Other as Renamed\n');

    expect(read.requests[0]?.bindings[0]?.local).toBe('Renamed');
  });

  it('publishes the top-level declarations of either language', () => {
    const java = readJava('Thing.java', 'package a;\npublic class Thing {}\ninterface Seen {}\n');
    const kotlin = readKotlin('t.kt', 'package a\n\nclass Thing\nfun parse() {}\n');

    expect((java.exports ?? []).map((entry) => entry.exported)).toEqual(['Thing', 'Seen']);
    expect((kotlin.exports ?? []).map((entry) => entry.exported)).toEqual(['Thing', 'parse']);
  });

  it('says so when the parser stopped where an import could have been', () => {
    expect(readJava('Thing.java', 'import a.B;\n@ ~ !\n').unknown).toContain('did not parse cleanly');
  });

  it('reads a file whose only error is inside a body, rather than marking it unknown', () => {
    const read = readJava('Thing.java', 'import a.B;\nclass Thing { void ( }\n');

    expect(read.requests.map((request) => request.value)).toEqual(['a.B']);
    expect(read.unknown).toBeUndefined();
  });
});

describe('where a JVM import lands', () => {
  // On disk, because a source root is derived from what a file *says* its
  // package is — a list of paths cannot answer that, and a world that cannot
  // read text is a world with no JVM roots in it.
  let root: string;
  let world: TreeWorld;

  beforeAll(async () => {
    await loadGrammars();
    root = await mkdtemp(join(tmpdir(), 'variance-jvm-'));
    await write(root, 'src/main/java/a/b/Thing.java', 'package a.b;\npublic class Thing {}\n');
    await write(root, 'src/main/java/a/b/Other.java', 'package a.b;\nclass Other {}\n');
    await write(root, 'src/main/java/a/c/Far.java', 'package a.c;\nclass Far {}\n');
    await write(root, 'src/test/java/a/b/ThingTest.java', 'package a.b;\nclass ThingTest {}\n');
    await write(root, 'src/main/kotlin/a/b/helpers.kt', 'package a.b\n\nfun parse() {}\n');
    world = worldOn(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('derives the source root from what the file says its package is', () => {
    // Nothing configures `src/main/java`. `a/b/Thing.java` declaring `a.b` is
    // what says the root is `src/main/java`, and a project that does not hold
    // to the convention is read the same way.
    expect(resolveJvm({ from: 'src/main/java/a/c/Far.java', request: 'a.b.Thing', world }))
      .toEqual(['src/main/java/a/b/Thing.java']);
  });

  it('unions the roots, so a test reaches the class it tests', () => {
    expect(resolveJvm({ from: 'src/test/java/a/b/ThingTest.java', request: 'a.b.*', world }))
      .toEqual([
        'src/main/java/a/b/Other.java',
        'src/main/java/a/b/Thing.java',
        'src/main/kotlin/a/b/helpers.kt',
      ]);
  });

  it('stops at the file when a segment left over is a name inside it', () => {
    // `a.b.Thing.Inner` and a static `a.b.Thing.of` are the same file.
    expect(resolveJvm({ from: 'src/main/java/a/c/Far.java', request: 'a.b.Thing.Inner', world }))
      .toEqual(['src/main/java/a/b/Thing.java']);
  });

  it('falls back to the package when a Kotlin name is not a filename', () => {
    // Kotlin has top-level declarations and no filename rule, so `a.b.parse`
    // may be declared in any Kotlin file of `a/b/`.
    expect(resolveJvm({ from: 'src/main/java/a/c/Far.java', request: 'a.b.parse', world }))
      .toEqual(['src/main/kotlin/a/b/helpers.kt']);
  });

  it('is silent about the platform and the dependency graph', () => {
    expect(resolveJvm({ from: 'src/main/java/a/b/Thing.java', request: 'java.util.List', world }))
      .toEqual([]);
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}
