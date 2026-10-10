import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleId } from '../instrument/index.js';
import { foldCaseRun, inspectCaseRun } from './case-fold.js';
import { lineAt, linesOf } from './case-lines.js';
import { AMBIENT, packCase, packFrames } from './cases.js';
import { decodeExecutionIndex } from './execution-format.js';
import { openSetColumns } from './execution-set-format.js';
import type { CapturedModule } from './instrumented-modules.js';
import type { ExecutionIndex } from './reverse.js';
import journalFormat from './journal-format.cjs';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function captured(file: string, id: ModuleId, blocks: number): CapturedModule {
  return {
    file,
    id,
    sourceDigest: 'digest',
    instrumented: true,
    blocks: Array.from({ length: blocks }, (_, ordinal) => ({
      ordinal,
      kind: ordinal === 0 ? 'module' : 'branch',
      digest: `block-${ordinal}`,
      name: ordinal === 0 ? '' : `branch-${ordinal}`,
      path: ordinal === 0 ? '' : `branch-${ordinal}`,
      startLine: ordinal + 1,
      endLine: ordinal + 1,
      source: true,
      testFiles: [],
    })),
  };
}

/** What a reader asks an index for: who entered each region anything reached, and whether a load reached it. */
function reach(index: ExecutionIndex): Record<string, { readonly entered: readonly string[]; readonly loaded?: true }> {
  const held: Record<string, { entered: string[]; loaded?: true }> = {};
  for (const module of index.modules) {
    for (const [ordinal, block] of module.blocks.entries()) {
      if (block.crossings.length === 0 && block.loaded !== true) continue;
      const entered = block.crossings.map((crossing) => index.tests[crossing.test]!.id);
      held[`${module.file}#${ordinal}`] = block.loaded === true ? { entered, loaded: true } : { entered };
    }
  }
  return held;
}

async function directory(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-case-fold-'));
  temporary.push(root);
  const cases = resolve(root, 'cases');
  await mkdir(cases);
  return cases;
}

/**
 * A bucket's read-out as `encodeLog` takes it: each row a module's ordinals,
 * entered once after any module evaluated, at the test line that reached each,
 * or with no lines where `lined` is false.
 */
function logged(rows: readonly (readonly [ModuleId, readonly (readonly [number, number])[]])[], lined = true) {
  const start = new Int32Array(rows.length);
  const end = new Int32Array(rows.length);
  const base = new Int32Array(rows.length);
  const sorted: number[] = [];
  const lines: number[] = [];
  for (const [row, [, reached]] of rows.entries()) {
    start[row] = sorted.length;
    base[row] = lines.length;
    for (const [ordinal, line] of reached) {
      sorted.push(ordinal << 1);
      lines[base[row]! + ordinal] = line;
    }
    for (let at = base[row]!; at < lines.length; at += 1) lines[at] ??= 0;
    end[row] = sorted.length;
  }
  return {
    rows: rows.map((_, row) => row),
    start,
    end,
    sorted: Int32Array.from(sorted),
    ids: rows.map(([id]) => id),
    ...(lined ? { base, lines: Int32Array.from(lines) } : {}),
  };
}

describe('the bounded case fold keeps the test line that reached each region', () => {
  it('charges a hook\'s statement to the ambient bucket and a test body\'s to its own case alone', async () => {
    const cases = await directory();
    const file = '/repo/test/branch.test.ts';
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      // `beforeEach` at line 3 reaches region 1 for every case of the file.
      journalFormat.encodeLog(packCase(file, AMBIENT, AMBIENT), logged([['src/branch.ts', [[1, 3]]]])),
      // Case one's body reaches region 2 at line 6 and region 1 itself at line 7.
      journalFormat.encodeLog(packCase(file, 'one', '1'), logged([['src/branch.ts', [[1, 7], [2, 6]]]])),
      journalFormat.encodeLog(packCase(file, 'two', '2'), logged([['src/branch.ts', [[3, 10]]]])),
    ]));
    const modules = new Map([['src/branch.ts', captured('src/branch.ts', 'src/branch.ts', 4)]]);

    const folded = await foldCaseRun(await inspectCaseRun(cases, '/repo'), modules, 64);

    const table = openSetColumns(folded.bytes)!.testLines;
    const [one, two] = [linesOf(table, 0)!, linesOf(table, 1)!];
    expect(lineAt(one, 0, 1)).toEqual({ line: 7, ambient: false });
    expect(lineAt(one, 0, 2)).toEqual({ line: 6, ambient: false });
    expect(lineAt(two, 0, 1)).toEqual({ line: 3, ambient: true });
    expect(lineAt(two, 0, 3)).toEqual({ line: 10, ambient: false });
    expect(reach(decodeExecutionIndex(folded.bytes))).toEqual({
      'src/branch.ts#1': { entered: ['test/branch.test.ts > one', 'test/branch.test.ts > two'] },
      'src/branch.ts#2': { entered: ['test/branch.test.ts > one'] },
      'src/branch.ts#3': { entered: ['test/branch.test.ts > two'] },
    });
  });

  it('records lines for a case of a cut file whose own bucket reached nothing', async () => {
    const cases = await directory();
    const file = '/repo/test/branch.test.ts';
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      // An import reaches region 1 before any hook or test statement runs.
      journalFormat.encodeLog(packCase(file, AMBIENT, AMBIENT), logged([['src/branch.ts', [[1, 0]]]], false)),
      journalFormat.encodeLog(packCase(file, 'one', '1'), logged([['src/branch.ts', [[2, 6]]]])),
      journalFormat.encodeLog(packCase(file, 'two', '2'), logged([], false)),
    ]));
    const modules = new Map([['src/branch.ts', captured('src/branch.ts', 'src/branch.ts', 3)]]);

    const folded = await foldCaseRun(await inspectCaseRun(cases, '/repo'), modules, 64);

    const two = linesOf(openSetColumns(folded.bytes)!.testLines, 1);
    expect(two).toBeDefined();
    expect(lineAt(two!, 0, 1)).toEqual({ line: 0, ambient: true });
  });

  it('records no lines for a case whose body ran uncut, declared by a helper outside the cut file', async () => {
    const cases = await directory();
    const file = '/repo/test/branch.test.ts';
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      journalFormat.encodeLog(packCase(file, AMBIENT, AMBIENT), logged([['src/branch.ts', [[1, 3]]]])),
      journalFormat.encodeLog(packCase(file, 'one', '1'), logged([['src/branch.ts', [[2, 6]]]])),
      journalFormat.encodeLog(packCase(file, 'two', '2'), logged([['src/branch.ts', [[2, 0]]]], false)),
    ]));
    const modules = new Map([['src/branch.ts', captured('src/branch.ts', 'src/branch.ts', 3)]]);

    const folded = await foldCaseRun(await inspectCaseRun(cases, '/repo'), modules, 64);

    const table = openSetColumns(folded.bytes)!.testLines;
    expect(linesOf(table, 0)).toBeDefined();
    expect(linesOf(table, 1)).toBeUndefined();
  });

  it('records no lines for a run nothing cut', async () => {
    const cases = await directory();
    await writeFile(resolve(cases, 'worker.vac'), packFrames([
      journalFormat.encodeLog(packCase('/repo/test/branch.test.ts', 'one', '1'), logged([['src/branch.ts', [[1, 0]]]], false)),
    ]));
    const modules = new Map([['src/branch.ts', captured('src/branch.ts', 'src/branch.ts', 2)]]);

    const folded = await foldCaseRun(await inspectCaseRun(cases, '/repo'), modules, 64);

    expect(openSetColumns(folded.bytes)!.testLines).toBeUndefined();
  });
});
