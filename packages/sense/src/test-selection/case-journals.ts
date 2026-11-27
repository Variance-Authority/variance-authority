// compass: variance-authority.reach
/**
 * Land a test file's cases as journals: what a recorder that runs one test at a
 * time and reads its regions afterwards hands the fold.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import caseOwner from './case-owner.cjs';
import journalFormat from './journal-format.cjs';

/**
 * The frames: the file's journal is the union of its tests, and each test is a
 * case frame of its own.
 */
export function writeJournals(
  selection: { readonly runDirectory: string; readonly caseDirectory: string },
  testFile: string,
  ran: readonly { readonly name: string }[],
  entered: readonly (readonly { readonly id: string; readonly ordinals: Uint32Array }[] | null)[],
): void {
  const stamp = `${process.pid}-${randomUUID()}`;
  const union = new Map<string, Set<number>>();
  const frames = ran.map((test, at) => {
    const modules = new Map<string, Set<number>>();
    for (const { id, ordinals } of entered[at] ?? []) {
      modules.set(id, new Set(ordinals));
      for (const ordinal of ordinals) union.set(id, (union.get(id) ?? new Set()).add(ordinal));
    }
    return journalFormat.encodeJournal(caseOwner.packCase(testFile, test.name, String(at)), counters(modules));
  });
  mkdirSync(selection.runDirectory, { recursive: true });
  writeFileSync(`${selection.runDirectory}/${stamp}.va`, journalFormat.encodeJournal(testFile, counters(union)));
  mkdirSync(selection.caseDirectory, { recursive: true });
  writeFileSync(`${selection.caseDirectory}/${stamp}.vac`, journalFormat.packFrames(frames));
}

/** Ordinals as the counters a journal reads: one at each entered region. */
function counters(modules: ReadonlyMap<string, ReadonlySet<number>>): Map<string, Uint32Array> {
  const out = new Map<string, Uint32Array>();
  for (const [id, ordinals] of modules) {
    const entered = new Uint32Array(Math.max(...ordinals) + 1);
    for (const ordinal of ordinals) entered[ordinal] = 1;
    out.set(id, entered);
  }
  return out;
}
