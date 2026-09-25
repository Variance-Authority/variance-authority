import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGrammars } from './grammar.js';
import { grainOf } from './language.js';
import { native, nativeAvailable } from './native.js';
import { readSwift, resolveSwift, targetsOf } from './swift.js';
import { worldOn, type TreeWorld } from './world.js';

/**
 * The language with no file-grain edge, answered at the grain it has.
 *
 * `import Core` names a target of tens or hundreds of files, and within a target
 * files see each other with no statement at all. So a Swift file names none of
 * the files it depends on, and the honest answer is the target projected onto
 * its files: over-reaching in the direction selection is allowed to over-reach,
 * rather than reporting a file as depending on nothing.
 */

describe('what a Swift file asks for', () => {
  beforeAll(async () => {
    await loadGrammars();
  });

  it('asks for the files beside it, which it imports nothing to see', () => {
    expect(readSwift('Sources/Core/Lens.swift', 'struct Lens {}\n').requests[0]?.value).toBe('*');
  });

  it('takes the module from an import that names a symbol inside it', () => {
    // `import struct Answer.Lens` depends on `Answer`; there is no grain below.
    const read = readSwift('a.swift', 'import Foundation\nimport struct Answer.Lens\n');

    expect(read.requests.map((request) => request.value)).toEqual(['*', 'Foundation', 'Answer']);
  });

  it('marks every import a guess, because a module name is not a path', () => {
    const read = readSwift('a.swift', 'import Core\n');

    expect(read.requests.every((request) => request.guessed === true)).toBe(true);
  });

  it('publishes the types, functions and values declared at the top level', () => {
    const read = readSwift('a.swift', 'struct Lens {}\nprotocol Seen {}\nfunc read() {}\nlet version = 1\n');

    expect((read.exports ?? []).map((entry) => entry.exported))
      .toEqual(['Lens', 'Seen', 'read', 'version']);
  });

  it('says so when the parser stopped where an import could have been', () => {
    expect(readSwift('a.swift', 'import Core\n@ ~ !\n').unknown).toContain('did not parse cleanly');
  });

  it('reads a file whose only error is inside a body, rather than marking it unknown', () => {
    const read = readSwift('a.swift', 'import Core\nstruct Lens { func ( }\n');

    expect(read.requests.map((request) => request.value)).toEqual(['*', 'Core']);
    expect(read.unknown).toBeUndefined();
  });

  it('is the one language whose edges are coarser than a file', () => {
    // Nothing downstream should report a Swift edge as though the file it
    // reaches is the file the symbol came from.
    expect(grainOf('swift')).toBe('target');
    expect(grainOf('rust')).toBe('file');
  });
});

describe('where a Swift module name lands', () => {
  let root: string;
  let world: TreeWorld;

  beforeAll(async () => {
    await loadGrammars();
    root = await mkdtemp(join(tmpdir(), 'variance-swift-'));

    // A `path:` that is not the default, because the default is only a default
    // and a manifest that spells one is the common case in a large package.
    await write(root, 'Package.swift', [
      'import PackageDescription',
      'let package = Package(name: "Shadow", targets: [',
      '  .target(name: "Core", path: "Sources/core"),',
      '  .target(name: "App"),',
      '  .testTarget(name: "CoreTests"),',
      '])',
    ].join('\n'));
    await write(root, 'Sources/core/Lens.swift', 'struct Lens {}\n');
    await write(root, 'Sources/core/deep/Seen.swift', 'struct Seen {}\n');
    await write(root, 'Sources/App/Main.swift', 'import Core\n');
    await write(root, 'Tests/CoreTests/LensTests.swift', 'import Core\n');
    await write(root, 'scripts/loose.swift', 'print("hi")\n');

    world = worldOn(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads the manifest as the program it is, `path:` and all', () => {
    expect(resolveSwift({ from: 'Sources/App/Main.swift', request: 'Core', world }))
      .toEqual(['Sources/core/Lens.swift', 'Sources/core/deep/Seen.swift']);
  });

  it('gives a file the whole of its own target, at any depth', () => {
    expect(resolveSwift({ from: 'Sources/core/Lens.swift', request: '*', world }))
      .toEqual(['Sources/core/deep/Seen.swift']);
  });

  it('falls back to SwiftPM defaults for a target that spells no path', () => {
    expect(resolveSwift({ from: 'Sources/core/Lens.swift', request: 'CoreTests', world }))
      .toEqual(['Tests/CoreTests/LensTests.swift']);
  });

  it('reads the same targets from a manifest with either grammar', () => {
    const manifest = [
      'let package = Package(name: "Shadow", targets: [',
      '  .target(name: "Core", path: "Sources/core"),',
      '  .testTarget(name: "CoreTests", dependencies: ["Core"]),',
      '  .executableTarget(name: "Tool"),',
      '])',
    ].join('\n');
    const expected = [
      { name: 'Core', path: 'Sources/core' },
      { name: 'CoreTests', path: 'Tests/CoreTests' },
      { name: 'Tool', path: 'Sources/Tool' },
    ];
    expect(targetsOf(manifest)).toEqual(expected);
    if (nativeAvailable()) expect(JSON.parse(native()!.swiftTargets!(manifest)!)).toEqual(expected);
  });

  it('keeps the manifest out of the graph it describes', () => {
    // It sits under no target; left in, it falls back to the repository root
    // and joins every Swift file in the tree to every other one.
    expect(resolveSwift({ from: 'Package.swift', request: '*', world })).toEqual([]);
  });

  it('gives a file no package claims only the files beside it', () => {
    expect(resolveSwift({ from: 'scripts/loose.swift', request: '*', world })).toEqual([]);
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}
