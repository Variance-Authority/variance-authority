import { attributed, type ComponentInstance } from './instances.js';
import type { SubjectComposition } from './composition.js';
import {
  LANDMARK_CAP,
  capLandmarks,
  isDigest,
  landmarkFor,
  walk,
  type Landmark,
} from './landmark.js';

/**
 * The subject-first folds: every name a subject carries, and its tree as rows.
 *
 * `composeSubjects` folds the suite component-first, which is the axis a
 * *finding* wants: which component, in how many subjects, mounted by whom. The
 * question an agent asks on arrival runs the other way: *which subject is the
 * one I mean*, and *what is that subject made of*. Both are one pass over the
 * same instance lists, done here so that whoever holds the lists, the run or a
 * test holding snapshots, gets the same rows the report carries.
 *
 * Neither fold ranks anything. The lexicon is values per field and the structure
 * is rows in document order; what a reader does with them is the reader's rule,
 * and it is printed where it is applied.
 */

/** The vocabularies a subject is indexed under. Mirrors the report's `LexiconField`. */
export type LexiconField =
  | 'example'
  | 'names'
  | 'text'
  | 'components'
  | 'createdBy'
  | 'regions'
  | 'files'
  | 'roles'
  | 'tokens';


/** One subject's names, per field, and where each thing was. */
export interface SubjectLexicon {
  readonly subject: string;
  /** Attributed boundaries. The only number a rank may read. */
  readonly boundaries: number;
  /** Distinct values per field, code-unit sorted; a field found empty is absent. */
  readonly terms: Partial<Record<LexiconField, readonly string[]>>;
  /** Distinct values a field's cap left out, where it cut. */
  readonly elided?: Partial<Record<LexiconField, number>>;

  /**
   * The same reading in the arrangement it was read in, document order.
   *
   * The fields above are what the subject *says*; this is where it said it. A
   * bag can answer that the subject holds the word `carrier` and the word
   * `contract` and can never answer that the second sits under the first, which
   * is the question somebody actually arrives with. Both come out of one walk
   * over one tree, because two walks eventually disagree about what was there.
   *
   * Absent on a subject with no snapshot. There is a real difference between a
   * dialog with nothing on it and a run that never looked.
   */
  readonly landmarks?: readonly Landmark[];
  /** Landmarks the cap left out. */
  readonly elidedLandmarks?: number;
}

/** What the fold cannot read off the instances and the snapshot. */
export interface LexiconOptions {
  /**
   * Subject → the components it is the narrow example of, from the composition.
   * Taken rather than re-derived so the lexicon and the census cannot disagree
   * about which story shows what.
   */
  readonly examples?: ReadonlyMap<string, readonly string[]>;
  /** Component → files declaring it, from the source index. */
  readonly declaredIn?: ReadonlyMap<string, readonly string[]>;
  /** Subject → lexical names of the regions its journey entered, from the journal. */
  readonly regions?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Distinct values kept per field. Generous, and what it cuts is counted in
 * `elided`, because a cap that says nothing reads as coverage.
 *
 * What it keeps is the narrower promise. Where a cap fires it keeps the values
 * the fewest other subjects hold, not the ones that sort first, because the
 * alternative is a rule about spelling: a subject whose tree is six hundred
 * boundaries deep under an application's worth of wrappers would keep
 * `Anonymous` and `Connect(Account)` and drop the one component it is about,
 * on no better ground than the alphabet. Ties keep code-unit order, so equal
 * values still land in the same place on every machine.
 */
export const LEXICON_CAP = 200;


/**
 * Every name each subject carries, per field.
 *
 * Fields come from three places and the option that supplies each says which:
 * the instances give `components`, `createdBy` and `tokens`; the snapshot, when
 * the subject carries one, gives `roles`, `names`, `text` and the call-site
 * `files`; the options give `example`, declared `files` and `regions`. A subject
 * with no snapshot still indexes under what its instances hold, which is the
 * honest shape for a sidecar read back without its document.
 *
 * Digests are never values. A text the policy declared volatile reaches the
 * snapshot as `v1:…`, and a reader that matched on it would be matching a
 * coordinate, not a word.
 *
 * Values are kept as they were read and never split. Splitting is a rule, and a
 * rule applied here would be applied to one side of a later comparison only —
 * the reader's query would meet tokens it did not produce. So the fold stores
 * words and the reader owns the rule, which is how a term and a value are
 * always measured by the same instrument.
 */
export function lexiconOf(
  subjects: readonly SubjectComposition[],
  options: LexiconOptions = {},
): readonly SubjectLexicon[] {
  return lexiconOfValues(subjects.map((subject) => lexiconValuesOf(subject, options)));
}

/**
 * The fold over readings already taken: the suite-wide count, then the cap.
 *
 * Exported for the reader that holds readings and no subjects — the shards of
 * one build, each of which read its own subjects and none of which saw how
 * widely the whole suite holds a value. Handed every shard's readings in plan
 * order, it writes the lexicon one unsharded run would have.
 */
export function lexiconOfValues(rows: readonly LexiconValues[]): readonly SubjectLexicon[] {
  const holders = holdersOf(rows);

  return rows.map((row) => {
    const terms: Partial<Record<LexiconField, readonly string[]>> = {};
    const elided: Partial<Record<LexiconField, number>> = {};
    for (const field of FIELDS) {
      const values = row.fields[field];
      if (values === undefined || values.length === 0) continue;

      // Code-unit first, so the result is byte-stable, and only then by how
      // widely the suite holds the value — a `sort` that keeps the order of
      // equal elements, which every engine's does since ES2019.
      const sorted = [...values].sort(codeUnit);
      const kept = sorted.length <= LEXICON_CAP
        ? sorted
        : [...sorted]
            .sort((left, right) => (holders.get(`${field} ${left}`) ?? 0) - (holders.get(`${field} ${right}`) ?? 0))
            .slice(0, LEXICON_CAP)
            .sort(codeUnit);

      terms[field] = kept;
      if (sorted.length > LEXICON_CAP) elided[field] = sorted.length - LEXICON_CAP;
    }

    const found = row.landmarks;
    const landmarks = found.length <= LANDMARK_CAP ? found : capLandmarks(found);

    return {
      subject: row.subject,
      boundaries: row.boundaries,
      terms,
      ...(Object.keys(elided).length === 0 ? {} : { elided }),
      ...(landmarks.length === 0 ? {} : { landmarks }),
      ...(found.length > LANDMARK_CAP ? { elidedLandmarks: found.length - LANDMARK_CAP } : {}),
    };
  });
}

/**
 * One subject's values per field before any cap, its landmarks, its boundary
 * count. Plain data, so a shard can write it down and another machine fold it.
 */
export interface LexiconValues {
  readonly subject: string;
  /** Distinct values per field, code-unit sorted; a field with none is absent. */
  readonly fields: Partial<Record<LexiconField, readonly string[]>>;
  readonly landmarks: readonly Landmark[];
  readonly boundaries: number;
}

/**
 * Every value a subject holds, per field, with nothing cut.
 *
 * Split from the fold above because a cap that keeps the values worth keeping
 * has to know how widely the *suite* holds each one, and that is not a fact any
 * single subject carries. So the pass that reads a subject and the pass that
 * decides what survives are two passes, with the counting in between.
 */
export function lexiconValuesOf(subject: SubjectComposition, options: LexiconOptions = {}): LexiconValues {
  {
    const fields = new Map<LexiconField, Set<string>>();
    const add = (field: LexiconField, value: string | undefined) => {
      if (value === undefined) return;
      const trimmed = value.trim();
      if (trimmed === '' || isDigest(trimmed)) return;
      let set = fields.get(field);
      if (set === undefined) fields.set(field, (set = new Set()));
      set.add(trimmed);
    };

    const held = subject.instances.filter(attributed);
    for (const instance of held) {
      add('components', instance.component);
      add('createdBy', instance.createdBy);
      for (const token of instance.tokens) add('tokens', token);
    }
    for (const component of options.examples?.get(subject.subject) ?? []) add('example', component);
    for (const region of options.regions?.get(subject.subject) ?? []) add('regions', region);

    const landmarks: Landmark[] = [];
    if (subject.snapshot !== undefined) {
      walk(subject.snapshot.root, undefined, (node, within) => {
        add('roles', node.role);
        add('names', node.name);
        add('names', node.description);
        // The three attributes that are a label for a person rather than a
        // value for a machine. `value` is state, `href` is a coordinate, and
        // `class` never survives normalization at all.
        add('names', node.attributes['placeholder']);
        add('names', node.attributes['alt']);
        add('names', node.attributes['title']);
        add('text', node.text);
        add('files', node.provenance?.source?.file);

        // The same visit, keeping what the bags drop. See `landmarkFor`.
        const landmark = landmarkFor(node, within);
        if (landmark === undefined) return within;
        const at = landmarks.length;
        landmarks.push(landmark);
        return at;
      });
    }

    const read: Partial<Record<LexiconField, readonly string[]>> = {};
    for (const field of FIELDS) {
      const values = fields.get(field);
      if (values !== undefined && values.size > 0) read[field] = [...values].sort(codeUnit);
    }
    const row = { subject: subject.subject, fields: read, landmarks, boundaries: held.length };
    return options.declaredIn === undefined ? row : withDeclaredIn(row, subject.instances, options.declaredIn);
  }
}

/**
 * A reading with the files declaring its components added to `files`.
 *
 * Where a component is declared is known only once the collection is over: the
 * engine's answers grow subject by subject, and they are laid over the scan at
 * the end. A collector that keeps no snapshot reads each subject as it arrives
 * and adds the declared files here, from the instances it kept.
 */
export function withDeclaredIn(
  row: LexiconValues,
  instances: readonly ComponentInstance[],
  declaredIn: ReadonlyMap<string, readonly string[]>,
): LexiconValues {
  const files = new Set(row.fields.files ?? []);
  for (const instance of instances) {
    if (!attributed(instance)) continue;
    for (const file of declaredIn.get(instance.component) ?? []) {
      const trimmed = file.trim();
      if (trimmed !== '' && !isDigest(trimmed)) files.add(trimmed);
    }
  }
  if (files.size === 0) return row;
  return { ...row, fields: { ...row.fields, files: [...files].sort(codeUnit) } };
}

/**
 * A reading with its `example` field taken again from a census.
 *
 * Which subject is the narrow example of a component is decided against every
 * subject that renders it, so a shard's reading answers it for the shard alone.
 * The build that holds every shard's census replaces the field with this.
 */
export function withExamples(row: LexiconValues, examples: readonly string[]): LexiconValues {
  const kept = [...new Set(examples.map((value) => value.trim()))]
    .filter((value) => value !== '' && !isDigest(value))
    .sort(codeUnit);
  const { example: _dropped, ...rest } = row.fields;
  return { ...row, fields: kept.length === 0 ? rest : { ...rest, example: kept } };
}

/**
 * How many subjects hold each value, per field.
 *
 * The one number that separates a name from a fixture. A value nearly every
 * subject carries is structure — a harness wrapper, a provider, an HOC, a
 * chunk every page imports — and a value one subject carries is what
 * distinguishes it. Counted rather than listed, so it costs nothing to be
 * wrong about which framework wrote the wrapper.
 */
function holdersOf(rows: readonly LexiconValues[]): ReadonlyMap<string, number> {
  const holders = new Map<string, number>();
  for (const row of rows) {
    for (const [field, values] of Object.entries(row.fields)) {
      for (const value of values ?? []) {
        const key = `${field} ${value}`;
        holders.set(key, (holders.get(key) ?? 0) + 1);
      }
    }
  }
  return holders;
}

/** Boundaries of one component at one place in a subject's tree. */
export interface BoundaryRow {
  readonly component: string;
  readonly depth: number;
  readonly within?: string;
  readonly createdBy?: string;
  /** Boundaries folded into this row. */
  readonly count: number;
  /** Distinct props digests among them; unknown props count as one. */
  readonly variants: number;
}

/**
 * One subject's boundaries as rows, document order, identical rows folded.
 *
 * A row's key is where it sits and who put it there: component, depth,
 * enclosing boundary, creator. Not what it rendered, because the question this
 * answers is *what is this subject made of* and three chips under one stack are
 * one answer to it. What differed among them survives as `variants`, so the
 * fold loses the digests and keeps the fact that there were several.
 */
export function structureOf(subject: SubjectComposition): readonly BoundaryRow[] {
  const rows = new Map<string, { row: BoundaryRow; props: Set<string> }>();

  for (const instance of subject.instances) {
    if (!attributed(instance)) continue;
    const key = [instance.component, instance.depth, instance.within ?? '', instance.createdBy ?? '']
      .join(' ');
    const props = instance.props ?? UNKNOWN;
    const held = rows.get(key);
    if (held === undefined) {
      rows.set(key, { row: rowOf(instance), props: new Set([props]) });
    } else {
      held.props.add(props);
      held.row = { ...held.row, count: held.row.count + 1 };
    }
  }

  return [...rows.values()].map(({ row, props }) => ({ ...row, variants: props.size }));
}

function rowOf(instance: ComponentInstance): BoundaryRow {
  return {
    component: instance.component,
    depth: instance.depth,
    ...(instance.within === undefined ? {} : { within: instance.within }),
    ...(instance.createdBy === undefined ? {} : { createdBy: instance.createdBy }),
    count: 1,
    variants: 1,
  };
}

const FIELDS: readonly LexiconField[] = [
  'example',
  'names',
  'text',
  'components',
  'createdBy',
  'regions',
  'files',
  'roles',
  'tokens',
];

const UNKNOWN = '(unknown props)';







/** Code-unit order: the same bytes on every machine, whatever `LANG` says. */
function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
