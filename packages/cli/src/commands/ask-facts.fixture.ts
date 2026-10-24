import { run } from './ask-packages-fixture.js';

/**
 * The facts `variance ask symbol`, `ask uses` and `ask search` answer, read
 * out of what they print today. `ask-acceptance-*.test.ts` asserts these facts
 * and never a sentence, so an answer that changes its wording, or turns into
 * rows, changes this file and no test.
 */

/** How far a declaration reaches: the ladder `symbol` answers on. */
export type Visibility = 'published' | 'exported' | 'unexported' | 'member';

/** One declaration of a name. */
export interface Declaration {
  name: string;
  kind: string | undefined;
  visibility: Visibility;
  file: string;
  /** The interface, type or class a member is declared in. */
  container: string | undefined;
  /** What a caller writes after `from` to import it, where one is answered. */
  specifier: string | undefined;
  /** The files that import it under another local name, and that name. */
  aliases: { file: string; local: string }[];
}

/** What `ask symbol --name <name>` answers. */
export interface SymbolAnswer {
  declarations: Declaration[];
  /** The import that binds `name` locally, when `name` is a local alias. */
  localOf: { file: string; imported: string } | undefined;
  /** The answer says nothing in the workspace declares the name. */
  missed: boolean;
  code: number;
}

const AT = String.raw`([^\s:]+):(\d+)`;

// TODO: retire this reading of the text once `symbol` answers `--format json`, the second gap of spec 0104
/** The facts of `ask symbol --name <name>`. */
export async function symbol(name: string): Promise<SymbolAnswer> {
  const { code, out } = await run(['ask', 'symbol', '--name', name]);
  const declarations: Declaration[] = [];
  let localOf: SymbolAnswer['localOf'];
  let missed = false;
  let header: { name: string; kind: string | undefined } | undefined;
  let specifier: string | undefined;
  const push = (visibility: Visibility, file: string, extra: Partial<Declaration> = {}): void => {
    declarations.push({ name: header?.name ?? name, kind: header?.kind, visibility, file, container: undefined, specifier: undefined, aliases: [], ...extra });
  };
  for (const line of out.split('\n')) {
    let m: RegExpExecArray | null;
    if (/No file in this workspace declares `[\w$]+`/u.test(line)) missed = true;
    if ((m = /^`[\w$]+` is a local name: (\S+):\d+ imports `([\w$]+)` as/u.exec(line))) localOf = { file: m[1]!, imported: m[2]! };
    else if ((m = /^([\w$]+)(?: \[(\w+)\])?$/u.exec(line))) {
      header = { name: m[1]!, kind: m[2] };
      specifier = undefined;
    } else if ((m = /^import \{ [\w$]+ \} from '([^']+)';$/u.exec(line))) specifier = m[1];
    else if ((m = new RegExp(`^declared at ${AT}$`, 'u').exec(line))) push('published', m[1]!, { specifier });
    else if (line.startsWith('not published:') && declarations.length > 0) declarations.at(-1)!.visibility = 'exported';
    else if ((m = new RegExp(`^declared, not exported, at ${AT}`, 'u').exec(line))) push('unexported', m[1]!);
    else if ((m = new RegExp(`^exported, without being published, at ${AT}`, 'u').exec(line))) push('exported', m[1]!);
    else if ((m = new RegExp(`^a member of \`([\\w$]+)\`, declared at ${AT}`, 'u').exec(line))) push('member', m[2]!, { container: m[1] });
    else if (line.startsWith('Imported under another name: ') && declarations.length > 0) {
      for (const a of line.matchAll(new RegExp(`${AT} as \`([\\w$]+)\``, 'gu'))) declarations.at(-1)!.aliases.push({ file: a[1]!, local: a[3]! });
    }
  }
  return { declarations, localOf, missed, code };
}

/** Where a use was found. */
export type Section = 'tests' | 'source' | 'own-file' | 'member';

/** One line `uses` names. */
export interface Use {
  file: string;
  section: Section;
  /** For a member's use, the container it is used as. */
  container: string | undefined;
  typeOnly: boolean;
  dynamic: boolean;
  /** The local name it is imported under, when it is renamed. */
  as: string | undefined;
  /** The module is imported as a namespace and passed on whole: the use may read the name. */
  passedOnWhole: boolean;
  access: 'read' | 'write' | undefined;
}

/** What `ask uses --name <name>` answers. */
export interface UsesAnswer {
  uses: Use[];
  /** The containers that declare `name` as a member. */
  memberOf: string[];
  /** Each other declaration of `name`, at its file, with its own uses. */
  namesakes: { at: string; uses: Use[] }[];
  code: number;
}

// TODO: retire this reading of the text once `uses` answers `--format json`, the second gap of spec 0104
/** The facts of `ask uses --name <name>`. */
export async function uses(name: string): Promise<UsesAnswer> {
  const { code, out } = await run(['ask', 'uses', '--name', name, '--limit', '1000']);
  const found: Use[] = [];
  const memberOf: string[] = [];
  const namesakes: { at: string; uses: Use[] }[] = [];
  let into = found;
  let section: Section | 'member-declarations' | undefined;
  let container: string | undefined;
  for (const line of out.split('\n')) {
    let m: RegExpExecArray | null;
    if ((m = new RegExp(`^\`[\\w$]+\` is .* at ${AT} as well, which is another declaration\\.$`, 'u').exec(line))) {
      namesakes.push({ at: m[1]!, uses: [] });
      into = namesakes.at(-1)!.uses;
      section = undefined;
    } else if (line === 'Tests:') section = 'tests';
    else if (line === 'Source:') section = 'source';
    else if (line === 'Member declarations:') section = 'member-declarations';
    else if (/^Used in \S+, which declares it:$/u.test(line)) section = 'own-file';
    else if ((m = /^`([\w$]+)\.[\w$]+`, declared at \S+, is used in/u.exec(line))) {
      section = 'member';
      container = m[1];
    } else if (section === 'member-declarations' && (m = new RegExp(`^${AT} — ([\\w$]+)$`, 'u').exec(line))) memberOf.push(m[3]!);
    else if (section === 'member' && (m = new RegExp(`^${AT} — \\S+, (read|write)$`, 'u').exec(line))) {
      into.push({ file: m[1]!, section, container, typeOnly: false, dynamic: false, as: undefined, passedOnWhole: false, access: m[3] as 'read' | 'write' });
    } else if (section !== undefined && section !== 'member-declarations' && (m = new RegExp(`^${AT} — [^\\s,]+(?:, [^(]+)?(?: \\((.+)\\))?$`, 'u').exec(line))) {
      const notes = m[3] ?? '';
      into.push({
        file: m[1]!,
        section,
        container: undefined,
        typeOnly: notes.includes('type only'),
        dynamic: notes.includes('import()'),
        as: /\bas ([\w$]+)/u.exec(notes)?.[1],
        passedOnWhole: notes.includes('passed on whole'),
        access: undefined,
      });
    }
  }
  return { uses: found, memberOf, namesakes, code };
}

/** One declaration `search` finds, in the order it ranks them. */
export interface Hit {
  name: string;
  file: string;
  visibility: Visibility;
}

/** What `ask search --query <words>` answers. */
export interface SearchAnswer {
  hits: Hit[];
  code: number;
}

/** The tiers `search` answers in today, and the visibility each one holds. */
const TIERS = [
  ['published', 'published'],
  ['exported', 'exported'],
  ['declared', 'unexported'],
  ['described', undefined],
] as const;

/** The facts of `ask search --query <words>`: its tiers read as one list, a tier above the next. */
export async function search(query: string): Promise<SearchAnswer> {
  const { code, out } = await run(['ask', 'search', '--query', query, '--format', 'json']);
  const json = JSON.parse(out) as Record<string, { shown?: { name: string; at: string; source?: string }[] } | undefined>;
  // An answer without these tiers is not read as one with no hits.
  if (!TIERS.some(([tier]) => json[tier] !== undefined)) throw new Error(`search answered none of its tiers: ${out}`);
  const hits: Hit[] = [];
  for (const [tier, visibility] of TIERS) {
    for (const hit of json[tier]?.shown ?? []) hits.push({ name: hit.name, file: hit.at, visibility: visibility ?? (hit.source as Visibility) });
  }
  return { hits, code };
}

/** One region of a file and the cases that entered it. */
export interface Region {
  start: number;
  end: number;
  cases: string[];
}

/** What `covering --file <path>` answers over one record. */
export interface CoveringAnswer {
  /** Per region, the cases that entered it; empty when a line was asked. */
  regions: Region[];
  /** The cases that entered the asked line, when one was asked. */
  cases: string[];
  /** The record holds no file of that name: the run never loaded it. */
  unloaded: boolean;
  /** The record was cut under other probes than this build places. */
  olderProbes: boolean;
  code: number;
}

interface CoveringJson {
  refused?: string;
  ranges?: { startLine: number; endLine: number; tests: { id: string }[] }[];
  tests?: { id: string }[];
  probes?: object;
}

/** The facts of `covering --file <path>` over the record at `execution`, and `more` flags. */
export async function covering(file: string, execution: string, root: string, more: readonly string[] = []): Promise<CoveringAnswer> {
  const { code, out } = await run(['covering', '--file', file, ...more, '--execution', execution, '--root', root, '--format', 'json']);
  const json = JSON.parse(out) as CoveringJson;
  return {
    regions: (json.ranges ?? []).map((range) => ({ start: range.startLine, end: range.endLine, cases: range.tests.map((test) => test.id) })),
    cases: (json.tests ?? []).map((test) => test.id),
    unloaded: json.refused === 'unloaded',
    olderProbes: json.probes !== undefined,
    code,
  };
}

/** The files of `rows`, in the order they are answered. */
export const filesOf = (rows: readonly { file: string }[]): string[] => rows.map((row) => row.file);
