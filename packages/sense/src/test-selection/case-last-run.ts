/**
 * The run that wrote a record's case index last, read back out of its
 * last-run layer.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { recordedCases, type CaseSections } from './case-record.js';
import { native } from '../addon.js';
import { whyAbsent } from './native-modules.js';
import type { NativeScanner } from '../native.js';

/**
 * The run that wrote the case index last. Its cases are in the index itself,
 * as that run left them, so this names them and holds nothing else.
 */
export interface LastCaseRun {
  readonly commit?: string;
  /**
   * The commit the cases in the before layer were recorded at: the commit of
   * the run that wrote the index before the first run at this one, or, when
   * the record crossed a checkout and names no such run, the commit its
   * snapshot stands at. Absent when neither names one, and when a run at this
   * commit ran a file again, because that file's before is then this commit's
   * own.
   */
  readonly before?: string;
  readonly at: string;
  /** Every test file the runs at this commit announced, so a run can tell whether it ran one again. */
  readonly files: readonly string[];
  /**
   * Files of `files` the before layer cannot answer for: a run at this commit
   * laid them over no index, or over one that began at this commit, and none
   * has run them since. What came before them is not known, which is not the
   * same as no case. Absent when every file has a base.
   */
  readonly unbased?: readonly string[];
  /**
   * The text each module of the before layer was cut from, by file, as the
   * coverage beside the index it was cut from named it. A reader compares it
   * with the text at `before` and reads no region of a module cut from another
   * text, since those regions stand on lines that commit does not have. A
   * module it does not name was cut from a text nobody here knew. Absent when
   * no run named one, which says nothing either way.
   */
  readonly beforeTexts?: Readonly<Record<string, string>>;
  /**
   * True when the first run at this commit was laid over no index, so every
   * case in it began at this commit and a file first run here has no base.
   * Absent when an earlier commit's index was under it.
   */
  readonly began?: true;
  /** The cases the last run recorded, by id. */
  readonly cases: readonly string[];
}

/** The addon's `name`, which reading a case index's last-run layer requires. */
function caseIndexAddon<K extends 'caseRowIds' | 'casesRanOf'>(name: K): NonNullable<NativeScanner[K]> {
  const found = native()?.[name];
  if (found === undefined) throw new Error(`reading a case index's last run requires the Sense native addon: ${whyAbsent(name)}`);
  return found as NonNullable<NativeScanner[K]>;
}

/** The run that wrote the case index last, or `undefined` when none named itself or its name cannot be read. */
export function lastCaseRunOf(sections: CaseSections): LastCaseRun | undefined {
  if (sections.last === undefined) return undefined;
  try {
    const run = JSON.parse(Buffer.from(sections.last).toString('utf8')) as Omit<LastCaseRun, 'cases'> & {
      readonly cases: readonly string[] | { readonly references: readonly (number | string)[] };
    };
    if (run === null || !Array.isArray(run.files)) return undefined;
    if (Array.isArray(run.cases)) return run.cases.every((id) => typeof id === 'string') ? { ...run, cases: run.cases } : undefined;
    const references = (run.cases as { readonly references?: unknown } | undefined)?.references;
    if (!Array.isArray(references)) return undefined;
    if (!references.every((id) => typeof id === 'string' || (typeof id === 'number' && Number.isInteger(id) && id >= 0))) return undefined;
    const rows = references.filter((id): id is number => typeof id === 'number');
    const ids = rows.length === 0 ? [] : caseIndexAddon('caseRowIds')(recordedCases(sections.index!), rows);
    let row = 0;
    const cases = references.map((id: string | number) => {
      if (typeof id === 'string') return id;
      const resolved = ids[row++];
      if (resolved == null) throw new Error('unresolved last-run case row');
      return resolved;
    });
    return { ...run, cases };
  } catch {
    return undefined;
  }
}

/**
 * The cases the run that wrote `sections` last executed, by test file, each
 * file's in code-unit order: the ones it laid, which the runs record names of
 * the files that run finished only in part (`landings.ts`). The sections are
 * what `layCases` or `landCases` wrote, whose last-run layer names only cases
 * its index holds.
 */
export function casesRan(sections: CaseSections): ReadonlyMap<string, readonly string[]> {
  const ran = new Map<string, string[]>();
  for (const { file, cases } of caseIndexAddon('casesRanOf')(sections.last!, recordedCases(sections.index!))) ran.set(file, cases);
  for (const ids of ran.values()) ids.sort(codeUnitOrder);
  return ran;
}
