import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGrammars } from './grammar.js';
import { pythonRootsOf, readPython, resolvePython } from './python.js';
import { worldIn } from './world.js';
import { scanRelations } from './scan.js';

/**
 * What a Python import statement says, and what it only implies.
 *
 * The distinction is the whole reason this reader is more than a node-kind
 * walk. `from a.b import c` names one module for certain and two more that may
 * or may not be modules at all, and the language offers nothing that tells them
 * apart — so the reader emits all of them and marks which ones it made up. A
 * made-up specifier that resolves is an edge; one that does not is silence.
 * Getting that backwards in either direction is a defect: silence on a written
 * specifier hides a hole, and noise on a derived one reports every package in
 * the tree as depending on modules nobody wrote.
 */

describe('what a Python file asks for', () => {
  beforeAll(async () => {
    await loadGrammars();
  });

  it('separates the module a statement writes from the ones it implies', () => {
    const read = readPython('t.py', 'from a.b import c, d as e\n');
    const asked = new Map(read.requests.map((request) => [request.value, request]));

    // Written, so a failure to resolve it is a real one.
    expect(asked.get('a.b')?.guessed).toBeUndefined();
    expect(asked.get('a.b')?.bindings.map((binding) => binding.local)).toEqual(['c', 'e']);

    // `a` and `a.b` are executed by this import when they are packages, and a
    // package with no `__init__.py` is ordinary (PEP 420) — so both are guesses.
    expect(asked.get('a')?.guessed).toBe(true);
    // `c` may be a submodule or a name `a/b/__init__.py` defines. Nothing here
    // can tell, and leaving it out misses a tenth of a real repository's edges.
    expect(asked.get('a.b.c')?.guessed).toBe(true);
    expect(asked.get('a.b.d')?.guessed).toBe(true);
    expect(asked.has('a.b.e')).toBe(false);
  });

  it('keeps the dots, because the dot count is the resolution', () => {
    const here = readPython('t.py', 'from . import x\n');
    const above = readPython('t.py', 'from .. import x\n');

    expect(here.requests.map((request) => request.value)).toContain('.');
    expect(above.requests.map((request) => request.value)).toContain('..');
    // No separator after the dots: `from . import x` is `.x`, not `..x`.
    expect(here.requests.map((request) => request.value)).toContain('.x');
    expect(above.requests.map((request) => request.value)).toContain('..x');
  });

  it('reads `if TYPE_CHECKING:` as a type import and its `else:` as a real one', () => {
    const read = readPython(
      't.py',
      'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from a import x\nelse:\n    from b import y\n',
    );
    const asked = new Map(read.requests.map((request) => [request.value, request]));

    // Erased before anything runs, exactly as a TypeScript type import is.
    expect(asked.get('a')?.kind).toBe('type');
    // The branch that actually runs. Marking it type-only erases a real edge.
    expect(asked.get('b')?.kind).toBe('imports');
  });

  it('publishes what it binds, and what it re-imports, and says when it cannot', () => {
    const read = readPython(
      'p/__init__.py',
      'from .create import Create\nimport os\n\n\nclass Widget:\n    pass\n\n\ndef _hidden():\n    pass\n\n\nvalue = 1\n',
    );
    const published = new Set((read.exports ?? []).map((held) => held.exported));

    // Importing a name into a package is how Python re-exports it.
    expect(published).toContain('Create');
    expect(published).toContain('Widget');
    expect(published).toContain('value');
    // The convention `from x import *` itself obeys.
    expect(published).not.toContain('_hidden');
  });

  it('answers `from x import *` with a set it does not name', () => {
    const read = readPython('t.py', 'from .colors import *\n');
    const opaque = (read.exports ?? []).find((held) => held.exported === undefined);

    // Absent is not empty: a consumer asking whether this file publishes `Red`
    // has to follow `from` rather than answer no.
    expect(opaque?.from).toBe('.colors');
  });

  it('lets `__all__` narrow the published set', () => {
    const read = readPython('t.py', "def a():\n    pass\n\n\ndef b():\n    pass\n\n\n__all__ = ['a']\n");

    expect((read.exports ?? []).map((held) => held.exported)).toEqual(['a']);
  });

  it('reads a literal dynamic import and refuses a computed one', () => {
    const literal = readPython('t.py', "import importlib\nm = importlib.import_module('a.b')\n");
    const computed = readPython('t.py', 'import importlib\n\n\ndef load(name):\n    return importlib.import_module(name)\n');

    expect(literal.requests.find((request) => request.value === 'a.b')?.kind).toBe('dynamic');
    expect(literal.unknown).toBeUndefined();
    // A target that is a runtime value is a surface nobody can look at.
    expect(computed.unknown).toContain('import_module');
  });

  it('says so when the parser stopped at an error', () => {
    expect(readPython('t.py', 'def broken(:\n').unknown).toContain('error');
  });
});

describe('where a Python specifier lands', () => {
  const tree = [
    'pyproject.toml',
    'a/pyproject.toml',
    'a/src/pkg/__init__.py',
    'a/src/pkg/one.py',
    'b/pyproject.toml',
    'b/src/pkg/two.py',
    'b/src/pkg/deep/three.py',
  ];
  const world = worldIn(tree);

  it('takes a source root from every manifest, and from `src` under each', () => {
    // Nineteen roots in a real monorepo; here, the two `src` directories a
    // manifest sits above, plus the repository itself.
    expect(pythonRootsOf(tree)).toEqual(['', 'a/src', 'a', 'b/src', 'b']);
  });

  it('unions the source roots, because one package can be spread across them', () => {
    // `pkg` has no single home: `pkg.one` is under `a/src` and `pkg.two` under
    // `b/src`, and only their union resolves both. A walk up from the importing
    // file finds one of the two.
    expect(resolvePython({ from: 'a/src/pkg/one.py', request: 'pkg.two', world }))
      .toEqual(['b/src/pkg/two.py']);
    expect(resolvePython({ from: 'b/src/pkg/two.py', request: 'pkg.one', world }))
      .toEqual(['a/src/pkg/one.py']);
  });

  it('counts the leading dots as the number of packages to climb', () => {
    expect(resolvePython({ from: 'b/src/pkg/deep/three.py', request: '.three', world }))
      .toEqual(['b/src/pkg/deep/three.py']);
    expect(resolvePython({ from: 'b/src/pkg/deep/three.py', request: '..two', world }))
      .toEqual(['b/src/pkg/two.py']);
  });

  it('prefers the module to the package of the same name', () => {
    expect(resolvePython({ from: 'a/src/pkg/one.py', request: 'pkg', world }))
      .toEqual(['a/src/pkg/__init__.py']);
  });
});

describe('a Python tree, scanned', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-python-'));

    await write(root, 'pyproject.toml', '[project]\nname = "fixture"\n');
    await write(root, 'src/pkg/__init__.py', 'from .answer import diagnose\n');
    await write(root, 'src/pkg/answer/__init__.py', 'VERSION = 1\n');
    await write(root, 'src/pkg/answer/diagnose.py', 'import json\n');
    await write(root, 'src/pkg/answer/lens.py', 'from ..answer import diagnose\n');
    // The shape one edge per statement misses: three siblings named through
    // their package, where `VERSION` is a name and the rest are modules.
    await write(root, 'tests/test_answer.py', 'from pkg.answer import VERSION, diagnose, lens\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reaches the sibling modules a `from package import` statement only implies', async () => {
    const records = await scanRelations({ root, dirs: ['.'], digests: false });
    const test = records.find((record) => record.file === 'tests/test_answer.py');

    expect(test?.edges?.map((edge) => edge.to)).toEqual([
      // `import pkg.answer` runs `pkg/__init__.py` on the way down, so a change
      // to it reaches this test too.
      'src/pkg/__init__.py',
      'src/pkg/answer/__init__.py',
      'src/pkg/answer/diagnose.py',
      'src/pkg/answer/lens.py',
    ]);
    // `VERSION` is a name, not a module. The reader guessed at it, the guess
    // found nothing, and that is an answer rather than a gap: nothing unresolved
    // and nothing unknown, because no surface went unlooked-at.
    expect(test?.unresolved).toBeUndefined();
    expect(test?.unknown).toBeUndefined();
  });

  it('draws code edges rather than asset edges to a language it reads', async () => {
    const records = await scanRelations({ root, dirs: ['.'], digests: false });
    const lens = records.find((record) => record.file === 'src/pkg/answer/lens.py');

    // `.py` is not a module extension, and a target that is not code is an
    // asset — which would hide every Python edge from a code-only traversal.
    expect(lens?.edges?.every((edge) => edge.kind === 'imports')).toBe(true);
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents);
}
