/**
 * Case indexes spelled the way a fold writes them, and read back by the cases
 * each region names: what the case layer's tests lay and compare.
 */

import type { CaseRunFiles } from '../case-layer.js';
import type { Said } from '../case-said.js';
import { CrossingSets } from '../crossing-sets.js';
import { decodeExecutionIndex } from '../execution-format.js';
import { encodeSetExecutionIndex, type SetExecutionModule } from '../execution-set-format.js';

/** A region, the cases that called it by id, and whether it ran at load. */
type Region = readonly [name: string, callers: readonly string[], loaded?: boolean, kind?: string];

/**
 * Spell a case index the way a fold writes one, from cases and the regions
 * they called, and what each case said it arranged where `said` names it.
 */
export function index(
  cases: readonly string[],
  modules: Record<string, readonly Region[]>,
  said: (id: string) => Said | undefined = () => undefined,
): Buffer {
  const tests = cases.map((id) => {
    const held = said(id);
    return { id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]!, ...(held === undefined ? {} : { said: held }) };
  });
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const at = new Map(cases.map((id, position) => [id, position]));
  const spelled: SetExecutionModule[] = Object.entries(modules).map(([file, regions]) => ({
    file,
    blocks: regions.map(([name, , , kind = 'function'], line) => ({
      kind, name, path: name, startLine: line + 1, endLine: line + 1, source: true,
    })),
    called: Uint32Array.from(regions, ([, callers]) => sets.intern(callers.map((id) => at.get(id)!))),
    loaded: Uint8Array.from(regions, ([, , loaded]) => (loaded ? 1 : 0)),
  }));
  return encodeSetExecutionIndex({ tests, modules: spelled, sets: sets.pool() });
}

/** Read an index back as the cases each region names, by file and region name. */
export function read(bytes: Uint8Array): { cases: string[]; regions: Record<string, Record<string, string[]>> } {
  const decoded = decodeExecutionIndex(bytes);
  return {
    cases: decoded.tests.map((test) => test.id),
    regions: Object.fromEntries(decoded.modules.map((module) => [
      module.file,
      Object.fromEntries(module.blocks.map((block) => [
        `${block.name}${block.loaded ? ' (loaded)' : ''}`,
        block.crossings.map((crossing) => decoded.tests[crossing.test]!.id),
      ])),
    ])),
  };
}

/** The files a run ran, finished, and those the checkout no longer holds. */
export function ran(files: readonly string[], finished: readonly string[] = files, absent: readonly string[] = []): CaseRunFiles {
  return { ran: new Set(files), finished: new Set(finished), present: (file) => !absent.includes(file) };
}
