import {
  flagOf,
  NONE,
  offsetsOf,
  rangeOf,
  sameLength,
  validateOffsets,
  type Column,
  type OpenSegment,
} from '@variance-authority/core/segment';
import type { Landmark, LexiconReport, SubjectLexicon } from './lexicon.js';
import type { SubjectCoverage, SuiteIndex, SuiteProvenance } from './suite-index.js';

/**
 * The facts version 2 of the suite index writes and version 1 did not: where
 * each landmark sits, where each component is declared, what became of every
 * planned subject, and what the index was composed from.
 *
 * Each is written with a flag beside it, because each has two absences: an
 * index that never looked and one that looked and found nothing. A version 1
 * index read here holds none of them, and says so by leaving them out.
 */

const OUTCOMES = ['collected', 'failed', 'excluded', 'unreached'] as const;
const PROVENANCE = ['plan', 'recipe', 'assignment', 'storybook', 'source', 'scope'] as const;
const LANDMARK_TEXT = ['role', 'name', 'text', 'file', 'component', 'createdBy', 'handle'] as const;

/** Every string the version 2 columns refer to. */
export function factVocabulary(index: SuiteIndex, into: Set<string>): void {
  for (const [component, files] of Object.entries(index.lexicon?.declaredIn ?? {})) {
    into.add(component);
    for (const file of files) into.add(file);
  }
  for (const subject of index.lexicon?.subjects ?? []) {
    for (const landmark of subject.landmarks ?? []) {
      for (const key of LANDMARK_TEXT) if (landmark[key] !== undefined) into.add(landmark[key]);
    }
  }
  for (const entry of index.coverage ?? []) {
    into.add(entry.subject);
    if (entry.because !== undefined) into.add(entry.because);
  }
  for (const key of PROVENANCE) if (index.provenance?.[key] !== undefined) into.add(index.provenance[key]);
}

export function encodeFacts(
  index: SuiteIndex,
  id: (value: string) => number,
  optionalId: (value: string | undefined) => number,
): Record<string, Column> {
  const lexicon = index.lexicon;
  const declared = Object.entries(lexicon?.declaredIn ?? {});
  const subjects = lexicon?.subjects ?? [];
  const landmarks = subjects.flatMap((subject) => subject.landmarks ?? []);
  const coverage = index.coverage ?? [];
  const provenance = index.provenance;

  const columns: Record<string, Column> = {
    'declared.present': Uint8Array.of(lexicon?.declaredIn === undefined ? 0 : 1),
    'declared.component': Uint32Array.from(declared, ([component]) => id(component)),
    'declared.files': offsetsOf(declared.map(([, files]) => files.length)),
    'declared-files.value': Uint32Array.from(declared.flatMap(([, files]) => files), id),
    'lexicon-subjects.landmarks-present': Uint8Array.from(subjects, (subject) => (subject.landmarks === undefined ? 0 : 1)),
    'lexicon-subjects.landmarks': offsetsOf(subjects.map((subject) => subject.landmarks?.length ?? 0)),
    'lexicon-subjects.elided-landmarks': Uint32Array.from(subjects, (subject) => subject.elidedLandmarks ?? NONE),
    'landmarks.within': Uint32Array.from(landmarks, (landmark) => landmark.within ?? NONE),
    'landmarks.line': Uint32Array.from(landmarks, (landmark) => landmark.line ?? NONE),
    'landmarks.box-present': Uint8Array.from(landmarks, (landmark) => (landmark.box === undefined ? 0 : 1)),
    'landmarks.box': Uint32Array.from(landmarks.flatMap((landmark) => (landmark.box ?? [0, 0, 0, 0]).map(zigzag))),
    'coverage.present': Uint8Array.of(index.coverage === undefined ? 0 : 1),
    'coverage.subject': Uint32Array.from(coverage, (entry) => id(entry.subject)),
    'coverage.outcome': Uint8Array.from(coverage, (entry) => OUTCOMES.indexOf(entry.outcome)),
    'coverage.because': Uint32Array.from(coverage, (entry) => optionalId(entry.because)),
    'provenance.present': Uint8Array.of(provenance === undefined ? 0 : 1),
    'provenance.values': Uint32Array.from(PROVENANCE, (key) => optionalId(provenance?.[key])),
  };
  for (const key of LANDMARK_TEXT) {
    columns[`landmarks.${columnOf(key)}`] = Uint32Array.from(landmarks, (landmark) => optionalId(landmark[key]));
  }
  return columns;
}

/** The version 2 facts, laid onto what the version 1 columns decoded. */
export function decodeFacts(
  opened: OpenSegment,
  read: SuiteIndex,
  text: (id: number) => string,
  optional: (id: number) => string | undefined,
): SuiteIndex {
  const reject = opened.reject;
  const lexicon = read.lexicon === undefined ? undefined : decodeLexiconFacts(opened, read.lexicon, text, optional);

  let coverage: SubjectCoverage[] | undefined;
  if (flagOf(opened.u8('coverage.present')[0], reject)) {
    const subject = opened.u32('coverage.subject');
    const outcome = opened.u8('coverage.outcome');
    const because = opened.u32('coverage.because');
    sameLength(subject.length, [outcome, because], reject);
    coverage = [...subject].map((name, row): SubjectCoverage => {
      const said = OUTCOMES[outcome[row]!];
      if (said === undefined) throw reject();
      const why = optional(because[row]!);
      return { subject: text(name), outcome: said, ...(why === undefined ? {} : { because: why }) };
    });
  }

  let provenance: SuiteProvenance | undefined;
  if (flagOf(opened.u8('provenance.present')[0], reject)) {
    const values = opened.u32('provenance.values');
    if (values.length !== PROVENANCE.length) throw reject();
    const entries = PROVENANCE.flatMap((key, at) => {
      const value = optional(values[at]!);
      return value === undefined ? [] : [[key, value] as const];
    });
    const held = Object.fromEntries(entries) as Partial<SuiteProvenance>;
    if (held.plan === undefined || held.recipe === undefined || held.assignment === undefined) throw reject();
    provenance = held as SuiteProvenance;
  }

  return {
    ...read,
    ...(lexicon === undefined ? {} : { lexicon }),
    ...(coverage === undefined ? {} : { coverage }),
    ...(provenance === undefined ? {} : { provenance }),
  };
}

function decodeLexiconFacts(
  opened: OpenSegment,
  lexicon: LexiconReport,
  text: (id: number) => string,
  optional: (id: number) => string | undefined,
): LexiconReport {
  const reject = opened.reject;

  let declaredIn: Record<string, readonly string[]> | undefined;
  if (flagOf(opened.u8('declared.present')[0], reject)) {
    const component = opened.u32('declared.component');
    const offsets = opened.u32('declared.files');
    const files = opened.u32('declared-files.value');
    validateOffsets(offsets, files.length, component.length, reject);
    declaredIn = Object.fromEntries(
      [...component].map((name, row) => [text(name), rangeOf(offsets, row, reject).map((at) => text(files[at]!))]),
    );
  }

  const present = opened.u8('lexicon-subjects.landmarks-present');
  const rows = opened.u32('lexicon-subjects.landmarks');
  const elided = opened.u32('lexicon-subjects.elided-landmarks');
  sameLength(lexicon.subjects.length, [present, elided], reject);
  const within = opened.u32('landmarks.within');
  const line = opened.u32('landmarks.line');
  const boxed = opened.u8('landmarks.box-present');
  const box = opened.u32('landmarks.box');
  const named = LANDMARK_TEXT.map((key) => [key, opened.u32(`landmarks.${columnOf(key)}`)] as const);
  sameLength(within.length, [line, boxed, ...named.map(([, column]) => column)], reject);
  if (box.length !== within.length * 4) throw reject();
  validateOffsets(rows, within.length, lexicon.subjects.length, reject);

  const landmarkAt = (at: number): Landmark => {
    const landmark: Record<string, unknown> = {};
    for (const [key, column] of named) {
      const value = optional(column[at]!);
      if (value !== undefined) landmark[key] = value;
    }
    if (within[at] !== NONE) landmark['within'] = within[at];
    if (line[at] !== NONE) landmark['line'] = line[at];
    if (flagOf(boxed[at], reject)) landmark['box'] = [0, 1, 2, 3].map((k) => unzigzag(box[at * 4 + k]!));
    return landmark as Landmark;
  };

  const subjects = lexicon.subjects.map((subject, row): SubjectLexicon => ({
    ...subject,
    ...(flagOf(present[row], reject) ? { landmarks: rangeOf(rows, row, reject).map(landmarkAt) } : {}),
    ...(elided[row] === NONE ? {} : { elidedLandmarks: elided[row]! }),
  }));
  return { ...lexicon, ...(declaredIn === undefined ? {} : { declaredIn }), subjects };
}

function columnOf(key: (typeof LANDMARK_TEXT)[number]): string {
  return key === 'createdBy' ? 'created-by' : key;
}

/** A box can start left of or above the page; zigzag keeps a signed integer in a `u32`. */
function zigzag(value: number): number {
  return ((value << 1) ^ (value >> 31)) >>> 0;
}

function unzigzag(value: number): number {
  return (value >>> 1) ^ -(value & 1);
}
