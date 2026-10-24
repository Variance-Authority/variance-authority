import { run } from './ask-packages-fixture.js';

/**
 * The facts `variance ask symbol` and `variance ask uses` answer, read out of
 * the text they print today. `ask-acceptance-*.test.ts` asserts these facts
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
  /** The other packages the answer says publish this same declaration. */
  alsoPublishedBy: string[];
  /** The files that import it under another local name, and that name. */
  aliases: { file: string; local: string }[];
}

/** What `ask symbol --name <name>` answers. */
export interface SymbolAnswer {
  declarations: Declaration[];
  /** The import that binds `name` locally, when `name` is a local alias. */
  localOf: { file: string; imported: string } | undefined;
  code: number;
}

const AT = String.raw`([^\s:]+):(\d+)`;

/** The facts of `ask symbol --name <name>`. */
export async function symbol(name: string): Promise<SymbolAnswer> {
  const { code, out } = await run(['ask', 'symbol', '--name', name]);
  const declarations: Declaration[] = [];
  let localOf: SymbolAnswer['localOf'];
  let header: { name: string; kind: string | undefined } | undefined;
  let specifier: string | undefined;
  const push = (visibility: Visibility, file: string, extra: Partial<Declaration> = {}): void => {
    declarations.push({ name: header?.name ?? name, kind: header?.kind, visibility, file, container: undefined, specifier: undefined, alsoPublishedBy: [], aliases: [], ...extra });
  };
  for (const line of out.split('\n')) {
    let m: RegExpExecArray | null;
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
    else if ((m = /^Also published by: (.+)$/u.exec(line)) && declarations.length > 0) declarations.at(-1)!.alsoPublishedBy = m[1]!.split(', ');
    else if (line.startsWith('Imported under another name: ') && declarations.length > 0) {
      for (const a of line.matchAll(new RegExp(`${AT} as \`([\\w$]+)\``, 'gu'))) declarations.at(-1)!.aliases.push({ file: a[1]!, local: a[3]! });
    }
  }
  return { declarations, localOf, code };
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
  code: number;
}

/** The facts of `ask uses --name <name>`. */
export async function uses(name: string): Promise<UsesAnswer> {
  const { code, out } = await run(['ask', 'uses', '--name', name, '--limit', '1000']);
  const found: Use[] = [];
  const memberOf: string[] = [];
  let section: Section | 'member-declarations' | undefined;
  let container: string | undefined;
  for (const line of out.split('\n')) {
    let m: RegExpExecArray | null;
    if (line === 'Tests:') section = 'tests';
    else if (line === 'Source:') section = 'source';
    else if (line === 'Member declarations:') section = 'member-declarations';
    else if (/^Used in \S+, which declares it:$/u.test(line)) section = 'own-file';
    else if ((m = /^`([\w$]+)\.[\w$]+`, declared at \S+, is used in/u.exec(line))) {
      section = 'member';
      container = m[1];
    } else if (section === 'member-declarations' && (m = new RegExp(`^${AT} — ([\\w$]+)$`, 'u').exec(line))) memberOf.push(m[3]!);
    else if (section === 'member' && (m = new RegExp(`^${AT} — \\S+, (read|write)$`, 'u').exec(line))) {
      found.push({ file: m[1]!, section, container, typeOnly: false, dynamic: false, as: undefined, passedOnWhole: false, access: m[3] as 'read' | 'write' });
    } else if (section !== undefined && section !== 'member-declarations' && (m = new RegExp(`^${AT} — [^\\s,]+(?:, [^(]+)?(?: \\((.+)\\))?$`, 'u').exec(line))) {
      const notes = m[3] ?? '';
      found.push({
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
  return { uses: found, memberOf, code };
}

/** The files of `rows`, in the order they are answered. */
export const filesOf = (rows: readonly { file: string }[]): string[] => rows.map((row) => row.file);
