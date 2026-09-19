import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { filesReached, refused } from './reach.js';

/**
 * The walk behind `variance reach`, asserted for the one property the command
 * rests on: **an answer is never empty**.
 *
 * Every other narrowing in this repository prints for a person, and a short
 * answer costs them a second look. This one prints for `xargs`, so a short
 * answer is a runner given nothing to run and a build that goes green in
 * seconds over a change nobody read. There are only two outcomes here — a list
 * holding at least the changed files, or a refusal — and the tests below are
 * that sentence, one clause at a time.
 */

const GRAPH = relationsOfFiles([
  { file: 'src/app/main.py', edges: [{ to: 'src/lib/parse.py', kind: 'imports' }] },
  { file: 'src/app/other.py', edges: [{ to: 'src/lib/parse.py', kind: 'imports' }] },
  { file: 'src/lib/parse.py' },
  { file: 'src/lib/alone.py' },
  { file: 'src/app/typed.py', edges: [{ to: 'src/lib/alone.py', kind: 'type' }] },
]);

const ROOTS = ['src'];

describe('every file a diff reaches', () => {
  it('holds the changed file itself, and every file that imports it', () => {
    const reach = filesReached(GRAPH, ['src/lib/parse.py'], ROOTS);
    if (refused(reach)) throw new Error(reach.whole);

    expect(reach.files).toEqual(['src/app/main.py', 'src/app/other.py', 'src/lib/parse.py']);
    expect(reach.seeded).toBe(1);
  });

  it('answers a file nothing imports with that file, and not with nothing', () => {
    // The case the whole command turns on. `alone.py` reaches no importer, and
    // the honest answer is *this one file* — which a runner can be handed. An
    // empty list here would be read as "run nothing" and would be wrong by the
    // width of the change.
    const reach = filesReached(GRAPH, ['src/lib/alone.py'], ROOTS);
    if (refused(reach)) throw new Error(reach.whole);

    expect(reach.files).toEqual(['src/lib/alone.py']);
  });

  it('does not reach through an edge that is erased before anything runs', () => {
    // `typed.py` imports `alone.py` under `if TYPE_CHECKING:`, and the same
    // distinction is `import type` in TypeScript. The walk defaults to
    // `RUNTIME_EDGES`, so a file that only names another for its types is not
    // something a change to that other file can move at run time.
    const reach = filesReached(GRAPH, ['src/lib/alone.py'], ROOTS);
    if (refused(reach)) throw new Error(reach.whole);

    expect(reach.files).not.toContain('src/app/typed.py');
  });

  it('refuses a changed file under the scanned roots the graph does not hold', () => {
    // A gap in the scan, which looks exactly like a file that affects nothing.
    // Answering it as the latter is the failure; naming it is the fix.
    const reach = filesReached(GRAPH, ['src/lib/parse.py', 'src/lib/new.py'], ROOTS);
    expect(refused(reach) && reach.unscanned).toEqual(['src/lib/new.py']);
  });

  it('refuses a diff no part of which is in the graph', () => {
    const reach = filesReached(GRAPH, ['yarn.lock', 'Dockerfile'], ROOTS);
    expect(refused(reach) && reach.whole).toMatch(/none of the 2 changed files is in the file graph/);
  });

  it('seeds a file whose own imports could not be read, and says so', () => {
    // `movedBy` widens through anything unreadable, because an unreadable file
    // may import the one that changed. The widening is named rather than
    // absorbed, so it is a work item rather than a tax.
    const opaque = relationsOfFiles([
      { file: 'src/lib/parse.py' },
      { file: 'src/app/generated.py', unknown: 'the file is generated at build time' },
    ]);
    const reach = filesReached(opaque, ['src/lib/parse.py'], ROOTS);
    if (refused(reach)) throw new Error(reach.whole);

    expect(reach.files).toContain('src/app/generated.py');
    expect(reach.how).toMatch(/because their own imports could not be read/);
  });
});
