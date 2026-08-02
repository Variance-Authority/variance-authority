import { readFile } from 'node:fs/promises';

/**
 * The story index, read strictly.
 *
 * A built Storybook writes `index.json` beside `iframe.html`: a map from story
 * id to the metadata the manager needs in order to load it. It is the only
 * artifact that knows what stories exist without evaluating any of them, which
 * is what makes it the subject list — subjects discovered here need no fixture
 * file and no second registry to drift out of date (spec 0006, acceptance 1).
 *
 * The reading is strict to the point of rudeness, and that is the design. Every
 * downstream sentence — *"these 240 subjects are the suite"*, *"this one
 * changed"* — is acted on by an agent that never sees the file. A parser that
 * shrugged at a shape it did not recognise would report a shorter suite, and a
 * suite that is quietly short is indistinguishable from a suite that passed.
 * So the three cases are kept apart:
 *
 * - **not an index** → refused, naming what was found instead;
 * - **an index with a malformed entry** → refused, naming the entry and the
 *   missing field, because a machine-generated file that does not match its own
 *   format is evidence the file is not what the caller thinks it is;
 * - **an entry that is well-formed but not a story** (docs, or a `type` this
 *   adapter has never heard of) → reported in {@link StoryIndex.excluded}.
 *
 * The cost of the middle case is real: one bad entry blocks a whole run. It is
 * preferred to a run that observes 239 subjects and says nothing about the 240th.
 *
 * Nothing here evaluates a story, starts a browser, or reads `.storybook/`.
 * Story *parameters* — viewport, exclusion — are not in the index and cannot be
 * recovered from it; `subjects.ts` documents where they come from instead.
 */

/** One story: a subject, before any policy has been applied to it. */
export interface StoryEntry {
  /** Storybook's own story id, e.g. `components-button--primary`. */
  readonly id: string;
  /** The sidebar path, e.g. `Components/Button`. */
  readonly title: string;
  /** The story's own name within that path, e.g. `Primary`. */
  readonly name: string;
  /** Module the story came from. The only route from a subject back to a file. */
  readonly importPath: string;
  /** Component module, when the index knows it. Absent in the older shape. */
  readonly componentPath?: string;
  /** Storybook tags. `[]` when the shape has no tags at all, never absent. */
  readonly tags: readonly string[];
}

/**
 * An entry that is a valid index entry and is not a subject.
 *
 * Kept rather than filtered so a report can state every skip. An index of 40
 * entries that yields 12 subjects is either correct or a disaster, and the
 * difference is only visible if the other 28 are named.
 */
export interface ExcludedEntry {
  readonly id: string;
  /** A sentence, not a code: this is printed to whoever is asking why. */
  readonly reason: string;
}

export type IndexShape = 'entries' | 'stories';

export interface StoryIndex {
  /** Path or label the index was read from, so every message can name it. */
  readonly source: string;
  /** The `v` the file declares. Absent when it declares none. */
  readonly version?: number;
  readonly shape: IndexShape;
  /** In the file's own order. Ordering is policy and belongs to `subjects.ts`. */
  readonly stories: readonly StoryEntry[];
  readonly excluded: readonly ExcludedEntry[];
  /**
   * Things worth saying that are not grounds for refusal — an unrecognised
   * version, a version that disagrees with the shape. Warnings travel with the
   * index into the subject plan rather than being logged and lost, because the
   * reader who needs them is reading a report, not a terminal.
   */
  readonly warnings: readonly string[];
}

/** Which top-level key each declared version is expected to use. */
const KNOWN_VERSIONS: Readonly<Record<number, IndexShape>> = { 3: 'stories', 4: 'entries', 5: 'entries' };

/**
 * Parse an already-decoded index. Pure, so the refusal rules are testable
 * without a filesystem — and so a caller holding an index fetched over HTTP from
 * a running dev server can use the same rules as one reading a built directory.
 */
export function parseStoryIndex(value: unknown, source: string): StoryIndex {
  if (!isRecord(value)) {
    throw new Error(
      `${source} is not a Storybook story index: the top level is ${describe(value)}, not an object.`,
    );
  }

  const warnings: string[] = [];
  const shape = shapeOf(value, source, warnings);
  const raw = value[shape];

  if (!isRecord(raw)) {
    // Unreachable via `shapeOf`, which only names a key it already checked. Kept
    // so a future edit to `shapeOf` cannot turn this into an undefined read.
    throw new Error(`${source}: \`${shape}\` is ${describe(raw)}, not an object of entries.`);
  }

  const version = versionOf(value, source, shape, warnings);
  const stories: StoryEntry[] = [];
  const excluded: ExcludedEntry[] = [];

  for (const [key, entry] of Object.entries(raw)) {
    const classified = classify(key, entry, shape, source);
    if ('reason' in classified) excluded.push({ id: key, reason: classified.reason });
    else stories.push(classified.story);
  }

  if (stories.length === 0 && excluded.length === 0) {
    // An index with no entries at all is far more likely to be a build that
    // found no stories than a project with none, and a run over zero subjects
    // exits green. Refusing is the only way that fact reaches anybody.
    throw new Error(
      `${source} declares no entries at all. A Storybook that found no stories writes exactly ` +
        `this file; check the \`stories\` globs in \`.storybook/main\` before trusting a green run.`,
    );
  }

  return {
    source,
    ...(version !== undefined ? { version } : {}),
    shape,
    stories,
    excluded,
    warnings,
  };
}

/**
 * Read and parse a story index from disk.
 *
 * Every failure names the path and says where the file is supposed to come
 * from. `ENOENT` on `index.json` is the single most likely first encounter with
 * this adapter, and "no such file or directory" alone does not tell anybody that
 * a Storybook has to be *built* before it has an index.
 */
export async function readStoryIndex(path: string): Promise<StoryIndex> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(
      `cannot read a Storybook story index at ${path}: ${messageOf(error)}. ` +
        `A built Storybook writes \`index.json\` next to \`iframe.html\` in its output directory ` +
        `(\`storybook build\`); a running dev server serves the same file at \`/index.json\`.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${path} is not JSON: ${messageOf(error)}. ` +
        `Pointing this at \`iframe.html\` or at a dev server's HTML shell fails exactly here.`,
    );
  }

  return parseStoryIndex(value, path);
}

/**
 * Decide which shape the file is in, by what it contains rather than by what it
 * claims.
 *
 * Dispatching on `v` would refuse a version this adapter has not met even when
 * the file is plainly in a shape it can read, and versions are minted by a
 * project on a release cadence nobody here controls. Dispatching on the key that
 * is actually present degrades in the useful direction: a newer index in a
 * familiar shape is read and *warned about*, rather than refused.
 */
function shapeOf(value: Readonly<Record<string, unknown>>, source: string, warnings: string[]): IndexShape {
  const hasEntries = value['entries'] !== undefined;
  const hasStories = value['stories'] !== undefined;

  if (hasEntries && hasStories) {
    warnings.push(
      `${source} carries both \`entries\` and \`stories\`; read as \`entries\`, which is the newer shape.`,
    );
    return 'entries';
  }
  if (hasEntries) return 'entries';

  if (hasStories) {
    if (Array.isArray(value['stories'])) {
      // `.storybook/main.js`'s `stories` is an array of globs, and a project that
      // exports it to JSON produces a file that passes a shallow "has stories"
      // check and yields zero subjects.
      throw new Error(
        `${source} is not a story index: \`stories\` is an array, which is the *glob list* from ` +
          `a Storybook config, not a map of story ids. The index is the \`index.json\` a build ` +
          `writes into its output directory.`,
      );
    }
    return 'stories';
  }

  throw new Error(
    `${source} is not a Storybook story index: it has neither an \`entries\` object (index v4/v5) ` +
      `nor a \`stories\` object (v3). Keys present: ${Object.keys(value).join(', ') || '(none)'}.`,
  );
}

function versionOf(
  value: Readonly<Record<string, unknown>>,
  source: string,
  shape: IndexShape,
  warnings: string[],
): number | undefined {
  const declared = value['v'];
  if (declared === undefined) {
    warnings.push(`${source} declares no \`v\`; read as the \`${shape}\` shape on the strength of its keys.`);
    return undefined;
  }
  if (typeof declared !== 'number') {
    throw new Error(`${source}: \`v\` is ${describe(declared)}, not a number; this is not a story index.`);
  }

  const expected = KNOWN_VERSIONS[declared];
  if (expected === undefined) {
    warnings.push(
      `${source} declares index version ${declared}, which this adapter was not written against ` +
        `(it knows ${Object.keys(KNOWN_VERSIONS).join(', ')}); read as the \`${shape}\` shape. ` +
        `Fields added by that version are ignored.`,
    );
  } else if (expected !== shape) {
    warnings.push(
      `${source} declares index version ${declared}, whose shape is \`${expected}\`, but carries ` +
        `\`${shape}\`; read as \`${shape}\`.`,
    );
  }
  return declared;
}

/** A story, or the reason this entry is not one. */
type Classified = { readonly story: StoryEntry } | { readonly reason: string };

function classify(key: string, entry: unknown, shape: IndexShape, source: string): Classified {
  if (!isRecord(entry)) {
    throw new Error(`${source}: entry \`${key}\` is ${describe(entry)}, not an object.`);
  }

  const id = idOf(entry, key, source);

  if (shape === 'entries') {
    const type = entry['type'];
    if (typeof type !== 'string') {
      // Every v4/v5 entry carries a `type`. One that does not is a file in some
      // other format that happens to have an `entries` key, and guessing "story"
      // would put an unrenderable thing into the suite.
      throw new Error(
        `${source}: entry \`${id}\` has no string \`type\` (found ${describe(type)}); ` +
          `every v4/v5 index entry declares one.`,
      );
    }
    if (type === 'docs') {
      return { reason: 'a docs entry (`type: "docs"`): prose about a component, not a render of one' };
    }
    if (type !== 'story') {
      return {
        reason:
          `entry type \`${type}\` is not a story; this adapter renders stories only, and does ` +
          `not guess at how to mount something it has never seen`,
      };
    }
  } else {
    // The pre-v4 shape has no `type`; a docs page is marked by a parameter.
    const parameters = entry['parameters'];
    if (isRecord(parameters) && parameters['docsOnly'] === true) {
      return { reason: 'a docs-only entry (`parameters.docsOnly`): prose about a component, not a render of one' };
    }
  }

  return { story: storyOf(entry, id, shape, source) };
}

function idOf(entry: Readonly<Record<string, unknown>>, key: string, source: string): string {
  const own = entry['id'];
  if (own === undefined) return key;
  if (typeof own !== 'string' || own === '') {
    throw new Error(`${source}: entry \`${key}\` has an \`id\` that is ${describe(own)}.`);
  }
  if (own !== key) {
    // Baselines are keyed on the story id and the manager addresses stories by
    // the map key. When the two disagree, one of them names a subject that will
    // never render, and there is no way to tell which from here.
    throw new Error(
      `${source}: entry \`${key}\` declares \`id: "${own}"\`. The key and the id address the ` +
        `same story and must agree; a run keyed on the wrong one observes nothing.`,
    );
  }
  return own;
}

function storyOf(
  entry: Readonly<Record<string, unknown>>,
  id: string,
  shape: IndexShape,
  source: string,
): StoryEntry {
  // `kind`/`story`/`parameters.fileName` are the pre-v4 names for
  // `title`/`name`/`importPath`. Read as fallbacks rather than as alternatives:
  // a v3 index written by a recent Storybook carries both, and the modern name
  // wins so that one project cannot produce two spellings of one subject.
  const parameters = entry['parameters'];
  const fileName = isRecord(parameters) ? parameters['fileName'] : undefined;

  const title = text(entry['title'] ?? entry['kind'], 'title', id, source, shape);
  const name = text(entry['name'] ?? entry['story'], 'name', id, source, shape);
  const importPath = text(entry['importPath'] ?? fileName, 'importPath', id, source, shape);
  const componentPath = entry['componentPath'];
  const tags = entry['tags'];

  if (tags !== undefined && !isStringArray(tags)) {
    throw new Error(`${source}: entry \`${id}\` has \`tags\` that are ${describe(tags)}, not an array of strings.`);
  }
  if (componentPath !== undefined && typeof componentPath !== 'string') {
    throw new Error(`${source}: entry \`${id}\` has a \`componentPath\` that is ${describe(componentPath)}.`);
  }

  return {
    id,
    title,
    name,
    importPath,
    ...(componentPath !== undefined ? { componentPath } : {}),
    tags: tags ?? [],
  };
}

/**
 * A required string field, or a refusal naming what is missing.
 *
 * `importPath` matters most: it is the only path from a changed subject back to
 * a file an agent can open, and a subject reported with an invented one sends
 * that agent to edit the wrong module with full confidence.
 */
function text(value: unknown, field: string, id: string, source: string, shape: IndexShape): string {
  if (typeof value === 'string' && value !== '') return value;

  const spelling: Readonly<Record<string, string>> = {
    title: '`kind`',
    name: '`story`',
    importPath: '`parameters.fileName`',
  };
  const older =
    shape === 'stories' && spelling[field] !== undefined
      ? ` (nor its pre-v4 spelling ${spelling[field] ?? ''})`
      : '';

  throw new Error(
    `${source}: entry \`${id}\` has no usable \`${field}\`${older}; found ${describe(value)}. ` +
      `Every story in an index has one, so this file is not the index it appears to be.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** A short, quotable description of a value, for a message somebody has to act on. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'absent';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  return `a ${typeof value}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
