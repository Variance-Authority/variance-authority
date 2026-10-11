// Laying a run's cases over an index whose regions share an address, told
// apart only by the order they were cut in, when the text moved between them.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layCases } from './case-landing.js';
import { layerCaseIndex } from './case-layer.js';
import type { CaseSections } from './case-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import { linesOf, nestedAt, ran } from './__fixtures__/case-index.js';

describe('siblings told apart only by occurrence, one taken out in front and one written behind', () => {
  const [alpha, beta, gamma] = ['alpha.test.ts > opens', 'beta.test.ts > closes', 'gamma.test.ts > renders'];
  const effect = 'Widget/useEffect.arg0';
  // Alpha entered the first effect and beta the second. The text the run
  // recorded took the first out and wrote a third behind the second, so the
  // run's cut holds two effects again: the first is beta's body, the second
  // is new. Paired by occurrence, alpha lands on beta's body.
  const held = nestedAt([alpha, beta, gamma], 'src/widget.ts', [
    ['module', '', [1, 11], [alpha, beta, gamma]],
    ['function', 'Widget', [1, 10], [alpha, beta, gamma]],
    ['function', effect, [2, 4], [alpha]],
    ['function', effect, [6, 8], [beta]],
  ]);

  /** The cases on each effect of the merged index, in the order the run cut them. */
  const effects = (merged: Buffer): string[][] => {
    const decoded = decodeExecutionIndex(merged);
    return decoded.modules[0]!.blocks
      .filter((block) => block.name === effect)
      .map((block) => block.crossings.map((crossing) => decoded.tests[crossing.test]!.id));
  };

  it('carries neither effect\'s cases onto the one at its occurrence when the run recorded another text', () => {
    // The effects stand at the lines the recorded ones did: nothing in the cut says which is which.
    const fresh = nestedAt([gamma], 'src/widget.ts', [
      ['module', '', [1, 11], [gamma]],
      ['function', 'Widget', [1, 10], [gamma]],
      ['function', effect, [2, 4], []],
      ['function', effect, [6, 8], []],
    ]);

    expect(effects(layerCaseIndex(held, fresh, ran(['gamma.test.ts'])).merged)).toEqual([[alpha, beta], [alpha, beta]]);
  });

  it('carries neither effect\'s cases onto the one at its occurrence when the index stands at an older text than the one named', () => {
    // A line written above the component as well: the snapshot re-cut its rows
    // to the text the run recorded, and the index kept the lines it was cut at.
    const fresh = nestedAt([gamma], 'src/widget.ts', [
      ['module', '', [1, 12], [gamma]],
      ['function', 'Widget', [2, 11], [gamma]],
      ['function', effect, [3, 5], []],
      ['function', effect, [7, 9], []],
    ]);

    const { merged, before } = layerCaseIndex(held, fresh, { ...ran(['gamma.test.ts']), sameText: () => true });

    expect(effects(merged)).toEqual([[alpha, beta], [alpha, beta]]);
    expect(linesOf(before)).toEqual([1, 2]);
  });

  // The run's cut holds the effects at lines 2-4 and 6-8, and the snapshot
  // names the index at the text the run recorded. The index was cut at an
  // older text whose two effects were the same length and swapped, or whose
  // first was taken out with one as long written behind the second, so every
  // region stands where the newer text put one and the cut reads as alike.
  // Paired by occurrence, alpha lands on beta's body (FIXME in
  // `region-landing.ts`).
  it.todo('carries neither effect\'s cases onto the one at its occurrence when an older text put both effects at the lines the recorded one does — needs the case index to record each region\'s digest');
});

describe('the before layer of a suite run in two invocations at one commit', () => {
  const [alpha, beta] = ['alpha.test.ts > opens', 'beta.test.ts > closes'];
  const file = 'src/widget.ts';
  const effect = 'Widget/useEffect.arg0';
  const text = new Map([[file, 'v1:one']]);
  const cut = (cases: readonly string[], widget: readonly string[], first: readonly string[]) => nestedAt(cases, file, [
    ['module', '', [1, 11], widget],
    ['function', 'Widget', [1, 10], widget],
    ['function', effect, [2, 4], first],
    ['function', effect, [6, 8], []],
  ]);
  const at = (commit: string, test: string) => ({ commit, tests: [{ file: test, complete: true }], modules: [{ file, sourceDigest: 'v1:one' }] });

  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-namesakes-before-'));
    for (const test of ['alpha.test.ts', 'beta.test.ts']) await writeFile(join(root, test), '');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps each namesake\'s cases where the base had them, since both invocations retired cuts of one text', () => {
    // CI's two selection waves: the near one ran alpha, the far one beta, both
    // at the merge commit, over a base that never changed the widget. Each
    // retired its own file's cases at the base's text, and the second lays
    // what it retired over what the first did.
    const base: CaseSections = {
      index: cut([alpha, beta], [alpha, beta], [alpha]),
      last: Buffer.from(JSON.stringify({ commit: 'base', at: '2026-10-11T00:00:00.000Z', files: ['alpha.test.ts', 'beta.test.ts'], cases: [alpha, beta] })),
    };
    const near = layCases(base, cut([alpha], [alpha], [alpha]), root, at('merge', 'alpha.test.ts'), undefined, text);
    const far = layCases(near, cut([beta], [beta], []), root, at('merge', 'beta.test.ts'), undefined, text);

    const before = decodeExecutionIndex(far.before!);
    const effects = before.modules[0]!.blocks
      .filter((block) => block.name === effect)
      .map((block) => block.crossings.map((crossing) => before.tests[crossing.test]!.id));
    expect(effects).toEqual([[alpha], []]);
  });
});
