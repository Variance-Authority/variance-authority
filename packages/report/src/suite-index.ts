import {
  encodeSegment,
  flagOf,
  intern,
  NONE,
  offsetsOf,
  openSegment,
  OtherSegmentVersion,
  rangeOf,
  sameLength,
  stringColumns,
  stringReader,
  validateOffsets,
  type Column,
  type OpenSegment,
} from '@variance-authority/core/segment';
import type { ComponentRecord } from './composition.js';
import type { NotObservedKind, RunReport } from './format.js';
import type { LexiconField, LexiconReport, SubjectLexicon } from './lexicon.js';
import { decodeFacts, encodeFacts, factVocabulary, listColumns, listReader } from './suite-index-facts.js';

/**
 * What a run knew about its suite, at a commit, as bytes.
 *
 * The run report is the artifact an agent reads about *this run*. This is the
 * other half, and it is a different artifact because it answers a different
 * question: **what did the suite look like somewhere else**. Which components
 * exist, which subjects hold them, which of them has an example of its own, and
 * every name the run wrote down. A branch asking any of those against `main` has
 * nothing to ask today, because `main`'s answers were computed on a machine that
 * has since gone away.
 *
 * ## Why it is not the report
 *
 * Half the composition is a *finding about one run* and would be a lie in a
 * baseline. `movements` is what moved since a comparison nobody else made;
 * `divergences` and `echoes` are readings of one commit's snapshots. None of them
 * is a fact about the suite, so none of them is here. What is here is the census,
 * the subject denominator it is counted against, and the lexicon — the three
 * things that are still true when read from another checkout.
 *
 * ## Why it is not JSON
 *
 * A lexicon is, structurally, the same few thousand strings written down once per
 * subject that holds them: component names, roles, files, tokens. In JSON every
 * occurrence is a fresh quoted copy, and the repetition *is* the payload. Interned
 * once and referenced by number, it stops being one —
 * [`core/segment`](../../core/src/segment/index.ts) is the arithmetic, shared with
 * the source index, which reached the same conclusion about the same kind of data.
 *
 * The argument the report file makes for its own format is about the file being
 * the contract rather than about the encoding: produced by CI on a pinned machine,
 * queried on a laptop, testable against something nobody rendered. All of that is
 * as true of a segment, and nobody reads a three-hundred-subject lexicon by eye.
 *
 * ## Position
 *
 * The index carries the commit it was written at and nothing else about where it
 * is, which is the rule
 * [`sense`'s selection index](../../sense/src/test-selection/commit.ts) already
 * settled: a commit answers *what changed since this was written* exactly, and a
 * timestamp says when a machine was rather than where a tree was. An index with
 * no commit is the honest record of a run that could not name itself, and a reader
 * holding one has nothing to diff — which is the direction this is allowed to fail
 * in.
 */
export interface SuiteIndex {
  /**
   * Where this is, and the whole of it. Absent when the run could not name
   * itself, which is a laptop and is not a default anybody may fill in.
   */
  readonly commit?: string;
  /** Subjects that contributed a snapshot, in plan order. The denominator. */
  readonly subjects: readonly string[];
  /** The census, in the order the composition wrote it: by name, code-unit order. */
  readonly components: readonly ComponentRecord[];
  /** Every name the run saw, per subject. Absent when the run read no names. */
  readonly lexicon?: LexiconReport;
  /**
   * What became of every subject the plan named, in plan order, then the ones
   * the plan itself left out. Absent from an index a run published, whose
   * report holds that list; present, failures included, from a collection.
   */
  readonly coverage?: readonly SubjectCoverage[];
  /** Which plan, recipe and cut the index was composed from. Absent from a run's. */
  readonly provenance?: SuiteProvenance;
}

/**
 * What became of one planned subject: read, or not observed in one of the ways
 * a run's report names, with a reason. A failed subject stays in the index, so
 * a lookup that misses it says it failed rather than that it is not there.
 */
export interface SubjectCoverage {
  readonly subject: string;
  readonly outcome: 'collected' | NotObservedKind;
  /** Why it was not collected. Absent for a collected subject. */
  readonly because?: string;
}

export interface SuiteProvenance {
  /** sha256 of the plan every part was cut from. */
  readonly plan: string;
  /** sha256 of what the evidence was read under. */
  readonly recipe: string;
  /**
   * How the plan was cut into shards. Not how many: the index is the same
   * whichever number of jobs read it, and says so by not depending on it.
   */
  readonly assignment: string;
  readonly storybook?: string;
  readonly source?: string;
  /** The `--subjects` glob the collection was narrowed by. Absent for the whole plan. */
  readonly scope?: string;
}

const FORMAT = 'variance-authority-suite-index';
/** Version 2 added landmarks, `declaredIn`, coverage and provenance; version 1 is still read. */
const VERSION = 2;
const FIRST_VERSION = 1;
const WHAT = 'suite index';

/**
 * The baseline-bearing half of a report.
 *
 * `undefined` when the run produced no composition — a raster-only tier holds no
 * boundaries and no names, and an index of nothing would answer *this suite holds
 * nothing* where the truth is *nothing was read*.
 */
export function suiteIndexOf(report: RunReport): SuiteIndex | undefined {
  const composition = report.composition;
  if (composition === undefined) return undefined;
  return {
    ...(report.run === undefined ? {} : { commit: report.run.commit }),
    subjects: composition.subjects,
    components: composition.components,
    ...(report.lexicon === undefined ? {} : { lexicon: report.lexicon }),
  };
}

/** Encode a suite index: interned strings, dense columns, and offset lists. */
export function encodeSuiteIndex(index: SuiteIndex): Uint8Array {
  const lexicon = index.lexicon;
  if (lexicon !== undefined) checkLexicon(lexicon);

  const { strings, id, optionalId } = intern(vocabulary(index));
  const { blob, off } = stringColumns(strings);

  const components = index.components;
  const subjects = listColumns(components, (entry) => entry.subjects, id);
  const examples = listColumns(components, (entry) => entry.examples, id);
  const within = listColumns(components, (entry) => entry.within, id);
  const createdBy = listColumns(components, (entry) => entry.createdBy, id);
  const renders = listColumns(components, (entry) => entry.renders, id);
  const tokens = listColumns(components, (entry) => entry.tokens, id);

  const perSubject = lexicon === undefined
    ? []
    : lexicon.subjects.map((subject) => entriesOf(subject, lexicon.fields));
  const entries = perSubject.flat();
  const terms = listColumns(entries, (entry) => entry.terms ?? [], id);

  const columns: Record<string, Column> = {
    'strings.blob': blob,
    'strings.off': off,
    'index.commit': Uint32Array.of(optionalId(index.commit)),
    'subjects.name': Uint32Array.from(index.subjects, id),
    'components.name': Uint32Array.from(components, (entry) => id(entry.component)),
    'components.instances': Uint32Array.from(components, (entry) => entry.instances),
    'components.variants': Uint32Array.from(components, (entry) => entry.variants),
    'components.renderings': Uint32Array.from(components, (entry) => entry.renderings),
    'components.subjects': subjects.offsets,
    'component-subjects.value': subjects.values,
    'components.examples': examples.offsets,
    'component-examples.value': examples.values,
    'components.within': within.offsets,
    'component-within.value': within.values,
    'components.created-by': createdBy.offsets,
    'component-created-by.value': createdBy.values,
    'components.renders': renders.offsets,
    'component-renders.value': renders.values,
    'components.tokens': tokens.offsets,
    'component-tokens.value': tokens.values,
    'lexicon.present': Uint8Array.of(lexicon === undefined ? 0 : 1),
    'lexicon.version': Uint32Array.of(lexicon?.version ?? 0),
    'lexicon.fields': Uint32Array.from(lexicon?.fields ?? [], id),
    'lexicon-subjects.name': Uint32Array.from(lexicon?.subjects ?? [], (row) => id(row.subject)),
    'lexicon-subjects.boundaries': Uint32Array.from(
      lexicon?.subjects ?? [],
      (row) => row.boundaries,
    ),
    'lexicon-subjects.entries': offsetsOf(perSubject.map((rows) => rows.length)),
    'entries.field': Uint32Array.from(entries, (entry) => entry.field),
    'entries.terms': terms.offsets,
    'entries.terms-present': Uint8Array.from(entries, (entry) => (entry.terms === undefined ? 0 : 1)),
    'entries.elided': Uint32Array.from(entries, (entry) => entry.elided ?? NONE),
    'terms.value': terms.values,
    ...encodeFacts(index, id, optionalId),
  };

  return encodeSegment(FORMAT, VERSION, columns);
}

/** Decode a suite index. Any malformed reference rejects the whole file. */
export function decodeSuiteIndex(input: Uint8Array): SuiteIndex {
  let opened: OpenSegment;
  try {
    opened = openSegment(FORMAT, VERSION, input, WHAT);
  } catch (error) {
    // Only a segment that says it is version 1 is read as one: bytes of version
    // 2 that do not read stay refused as what they are.
    if (!(error instanceof OtherSegmentVersion) || error.written !== FIRST_VERSION) throw error;
    // Written before the facts below were: what it holds is read, and what it
    // never wrote is left out rather than filled in.
    return decodeColumns(openSegment(FORMAT, FIRST_VERSION, input, WHAT)).read;
  }
  const { read, text, optional } = decodeColumns(opened);
  return decodeFacts(opened, read, text, optional);
}

/** The columns both versions write. */
function decodeColumns(opened: OpenSegment): {
  readonly read: SuiteIndex;
  readonly text: (id: number) => string;
  readonly optional: (id: number) => string | undefined;
} {
  const reject = opened.reject;
  const { text, optional } = stringReader(
    opened.u8('strings.blob'),
    opened.u32('strings.off'),
    reject,
  );

  const name = opened.u32('components.name');
  const instances = opened.u32('components.instances');
  const variants = opened.u32('components.variants');
  const renderings = opened.u32('components.renderings');
  sameLength(name.length, [instances, variants, renderings], reject);

  const list = (offsetColumn: string, valueColumn: string, rows: number) => listReader(opened, offsetColumn, valueColumn, rows, text);

  const subjectsOf = list('components.subjects', 'component-subjects.value', name.length);
  const examplesOf = list('components.examples', 'component-examples.value', name.length);
  const withinOf = list('components.within', 'component-within.value', name.length);
  const createdByOf = list('components.created-by', 'component-created-by.value', name.length);
  const rendersOf = list('components.renders', 'component-renders.value', name.length);
  const tokensOf = list('components.tokens', 'component-tokens.value', name.length);

  const components: ComponentRecord[] = [];
  for (let row = 0; row < name.length; row += 1) {
    components.push({
      component: text(name[row]!),
      subjects: subjectsOf(row),
      instances: instances[row]!,
      examples: examplesOf(row),
      within: withinOf(row),
      createdBy: createdByOf(row),
      renders: rendersOf(row),
      tokens: tokensOf(row),
      variants: variants[row]!,
      renderings: renderings[row]!,
    });
  }

  const commit = optional(opened.u32('index.commit')[0]!);
  const read: SuiteIndex = {
    ...(commit === undefined ? {} : { commit }),
    subjects: [...opened.u32('subjects.name')].map(text),
    components,
    ...decodeLexicon(opened, text, reject),
  };
  return { read, text, optional };
}

/** One subject's terms and elisions, folded to one row per field it mentions. */
interface LexiconEntry {
  readonly field: number;
  /** Absent when the field is elided-only, which is not the same as read-and-empty. */
  readonly terms?: readonly string[];
  readonly elided?: number;
}

function entriesOf(
  subject: SubjectLexicon,
  fields: readonly LexiconField[],
): readonly LexiconEntry[] {
  const mentioned = new Set<LexiconField>([
    ...(Object.keys(subject.terms) as LexiconField[]),
    ...(Object.keys(subject.elided ?? {}) as LexiconField[]),
  ]);
  return [...mentioned]
    .map((field): LexiconEntry => {
      const terms = subject.terms[field];
      const elided = subject.elided?.[field];
      return {
        field: fields.indexOf(field),
        ...(terms === undefined ? {} : { terms }),
        ...(elided === undefined ? {} : { elided }),
      };
    })
    .sort((left, right) => left.field - right.field);
}

/**
 * A subject may only speak in vocabularies the run says it read.
 *
 * Refused at the encode rather than carried, because the two absences a lexicon
 * distinguishes — *read and found nothing* against *never looked at* — stop being
 * distinguishable the moment a subject can hold terms for a field the header does
 * not list. A reader would have no way to tell which sentence it was holding.
 */
function checkLexicon(lexicon: LexiconReport): void {
  const fields = new Set<string>(lexicon.fields);
  for (const subject of lexicon.subjects) {
    for (const field of [...Object.keys(subject.terms), ...Object.keys(subject.elided ?? {})]) {
      if (!fields.has(field)) {
        throw new Error(
          `${subject.subject} carries lexicon field ${JSON.stringify(field)}, ` +
            'which this run did not read',
        );
      }
    }
  }
}

function decodeLexicon(
  opened: OpenSegment,
  text: (id: number) => string,
  reject: () => Error,
): { lexicon?: LexiconReport } {
  if (!flagOf(opened.u8('lexicon.present')[0], reject)) return {};
  if (opened.u32('lexicon.version')[0] !== 1) throw reject();

  const fields = [...opened.u32('lexicon.fields')].map(text) as LexiconField[];
  const name = opened.u32('lexicon-subjects.name');
  const boundaries = opened.u32('lexicon-subjects.boundaries');
  const rows = opened.u32('lexicon-subjects.entries');
  const field = opened.u32('entries.field');
  const present = opened.u8('entries.terms-present');
  const elided = opened.u32('entries.elided');
  const termOffsets = opened.u32('entries.terms');
  const termValues = opened.u32('terms.value');
  sameLength(name.length, [boundaries], reject);
  sameLength(field.length, [present, elided], reject);
  validateOffsets(rows, field.length, name.length, reject);
  validateOffsets(termOffsets, termValues.length, field.length, reject);

  const subjects: SubjectLexicon[] = [];
  for (let row = 0; row < name.length; row += 1) {
    const terms: Partial<Record<LexiconField, readonly string[]>> = {};
    const cut: Partial<Record<LexiconField, number>> = {};
    for (const entry of rangeOf(rows, row, reject)) {
      const named = fields[field[entry]!];
      if (named === undefined) throw reject();
      if (flagOf(present[entry], reject)) {
        terms[named] = rangeOf(termOffsets, entry, reject).map((at) => text(termValues[at]!));
      }
      if (elided[entry] !== NONE) cut[named] = elided[entry]!;
    }
    subjects.push({
      subject: text(name[row]!),
      boundaries: boundaries[row]!,
      terms,
      ...(Object.keys(cut).length === 0 ? {} : { elided: cut }),
    });
  }
  return { lexicon: { version: 1, fields, subjects } };
}

function vocabulary(index: SuiteIndex): Iterable<string> {
  const values = new Set<string>();
  if (index.commit !== undefined) values.add(index.commit);
  for (const subject of index.subjects) values.add(subject);
  for (const entry of index.components) {
    values.add(entry.component);
    for (const list of [
      entry.subjects,
      entry.examples,
      entry.within,
      entry.createdBy,
      entry.renders,
      entry.tokens,
    ]) for (const value of list) values.add(value);
  }
  for (const field of index.lexicon?.fields ?? []) values.add(field);
  for (const subject of index.lexicon?.subjects ?? []) {
    values.add(subject.subject);
    for (const list of Object.values(subject.terms)) for (const value of list) values.add(value);
  }
  factVocabulary(index, values);
  return values;
}
