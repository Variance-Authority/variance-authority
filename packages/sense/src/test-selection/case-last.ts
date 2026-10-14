import type { CaseSections } from './case-record.js';
import { codeUnitOrder } from './instrumented-modules.js';

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

/** The run that wrote the case index last, or `undefined` when none named itself or its name cannot be read. */
export function lastCaseRunOf(sections: CaseSections): LastCaseRun | undefined {
  if (sections.last === undefined) return undefined;
  try {
    return JSON.parse(Buffer.from(sections.last).toString('utf8')) as LastCaseRun;
  } catch {
    return undefined;
  }
}

/** The last-run section's bytes. */
export function spelledLast(named: LastCaseRun): Buffer {
  return Buffer.from(`${JSON.stringify(named, null, 2)}\n`);
}

/** Recorded last-run rows combined without synthesizing checkout history. */
export function combineCaseRuns(sections: readonly CaseSections[], cases: () => readonly string[]): Uint8Array | undefined {
  const bytes = sections.flatMap((part) => part.last === undefined ? [] : [part.last]);
  if (bytes.length === 0) return undefined;
  const rows = bytes.map(recordedRun);
  const held = new Set(cases());
  for (const row of rows) for (const id of row.cases) if (!held.has(id)) throw new Error(`a recorded last run names a case the artifacts do not hold: ${id}`);
  if (bytes.length === 1) return bytes[0]!;
  const commit = agreed(rows.map((row) => row.commit), 'commit');
  const before = agreed(rows.map((row) => row.before), 'before commit');
  const texts = new Map<string, string>();
  for (const row of rows) for (const [file, text] of Object.entries(row.beforeTexts ?? {})) {
    if (texts.has(file) && texts.get(file) !== text) throw new Error(`recorded before texts disagree for ${file}`);
    texts.set(file, text);
  }
  const union = (values: readonly (readonly string[])[]) => [...new Set(values.flat())].sort(codeUnitOrder);
  return spelledLast({
    ...(commit === undefined ? {} : { commit }), ...(before === undefined ? {} : { before }),
    at: rows.map((row) => row.at).sort(codeUnitOrder).at(-1)!, files: union(rows.map((row) => row.files)), cases: union(rows.map((row) => row.cases)),
    ...(rows.some((row) => row.unbased !== undefined) ? { unbased: union(rows.map((row) => row.unbased ?? [])) } : {}),
    ...(rows.some((row) => row.beforeTexts !== undefined) ? { beforeTexts: Object.fromEntries([...texts].sort(([left], [right]) => codeUnitOrder(left, right))) } : {}),
    ...(rows.every((row) => row.began === true) ? { began: true } : {}),
  });
}

function agreed(values: readonly (string | undefined)[], field: string): string | undefined {
  const known = [...new Set(values.filter((value): value is string => value !== undefined))];
  if (known.length > 1) throw new Error(`recorded last runs disagree about their ${field}`);
  return known[0];
}

function recordedRun(bytes: Uint8Array): LastCaseRun {
  const row = lastCaseRunOf({ last: bytes });
  const strings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
  const fields: Record<keyof LastCaseRun, true> = { commit: true, before: true, at: true, files: true, unbased: true, beforeTexts: true, began: true, cases: true };
  if (row === undefined || row === null || typeof row !== 'object' || typeof row.at !== 'string' || !strings(row.files) || !strings(row.cases) ||
    row.commit !== undefined && typeof row.commit !== 'string' || row.before !== undefined && typeof row.before !== 'string' ||
    row.unbased !== undefined && !strings(row.unbased) || row.began !== undefined && row.began !== true ||
    row.beforeTexts !== undefined && (row.beforeTexts === null || typeof row.beforeTexts !== 'object' || Array.isArray(row.beforeTexts) || Object.values(row.beforeTexts).some((text) => typeof text !== 'string')) ||
    Object.keys(row).some((field) => !Object.hasOwn(fields, field))) throw new Error('cannot combine a recorded last-run section this build cannot read');
  return row;
}
