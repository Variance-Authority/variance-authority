import { extname } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { SourceNames, Tool, Tree } from '@variance-authority/mcp/tools';
import { entryPoints, pathsOf, refusalFor, startPointArg } from '@variance-authority/mcp/tools';
import { READABLE } from '@variance-authority/sense';
import { ripgrep } from './ripgrep.js';
import { importsOf as importersOf } from './unpublished.js';

/**
 * `docs_discover` — the files in every one of several sets.
 *
 * Each question the source answers on its own is a set of files: what a path
 * reaches, what reaches it, who imports a name, who declares one, whose path
 * matches. A question a person asks is usually several of those at once —
 * *the contexts the nav can reach, made by `createContext`, named for the theme
 * or the user* — and each set alone is a haystack. So every operand is read
 * whole, never capped, and only the answer is limited: an operand cut to its
 * first fifty would lose exactly the file the others were going to agree on.
 *
 * ## Crossed, never joined
 *
 * `search --from a --from b` joins two start points, because two entry points
 * of one application share almost nothing. Here a second start point is a
 * second set, and the answer is what both reach: the explicit counterpart, for
 * the question that wants it. An `except` operand takes every file it holds out
 * of the answer.
 *
 * ## Text comes last
 *
 * A pattern is ripgrep's, over the files the other operands kept — never over
 * the checkout, which `rg` answers without this. So `text` alone is refused
 * with the command that answers it.
 *
 * ## Names are read with the tree
 *
 * `declares`, and `imports` of a package or a specifier as written, read every
 * file's names, which the scan that drew the tree holds as it parses. A host
 * that read the tree without them refuses those operands rather than answering
 * as though no file declared anything. A name out of a file the tree holds is
 * read off the source index, as `uses` reads it, and needs no names.
 */

/** Files shown when `limit` is not said; every one is counted. */
const SHOWN = 50;

/** One set, read whole, and how it says a file is in it. */
interface Operand {
  readonly header: string;
  readonly files: ReadonlySet<string>;
  /** Import distance from or to its start point; reach operands only. */
  readonly distance?: ReadonlyMap<string, number>;
  readonly evidence: (file: string) => readonly string[];
}

const counted = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;
const imports = (count: number): string => `${count} ${count === 1 ? 'import' : 'imports'}`;
const none = (): readonly string[] => [];

/**
 * The files a reader claims and the names do not hold: a file whose names the
 * scan could not hand over is unknown, never a file that declares and imports
 * nothing, so a name operand says how many there are. A file no reader claims,
 * a README or a manifest, has no names to read and is not counted.
 */
function unreadOf(tree: Tree, names: SourceNames): string {
  let unread = 0;
  for (const file of tree.files) if (READABLE.has(extname(file)) && !names.has(file)) unread += 1;
  return unread === 0 ? '' : ` — the names of ${counted(unread)} were not read`;
}

/** `react/jsx-runtime` is `react`; `./store/selectors` is not `./store`. */
const isBare = (spec: string): boolean => !spec.startsWith('.') && !spec.startsWith('/');

/** One or several values, said as a string or an array. */
function listArg(input: Readonly<Record<string, unknown>>, name: string): readonly string[] {
  return pathsOf(startPointArg(input, name));
}

function textArg(input: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const said = input[name];
  return typeof said === 'string' && said.trim() !== '' ? said : undefined;
}

function limitArg(input: Readonly<Record<string, unknown>>): number {
  const said = input['limit'];
  return typeof said === 'number' && Number.isInteger(said) && said > 0 ? said : SHOWN;
}

function regexOf(name: string, pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`\`${name}\` is not a regular expression: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

/** Everything a path reaches along the imports, or everything reaching it. */
function reach(term: string, tree: Tree, along: boolean): Operand {
  const seeds = entryPoints([term], tree);
  const refused = refusalFor(seeds.unmatched);
  if (refused !== undefined) {
    throw new Error(
      `\`discover\` ran nothing: ${refused}. Say a real path from the root — \`src/a/File.ts\` is ` +
        "that file, `src/a/*` its folder's own files, `src/a/` everything under it.",
    );
  }
  const distance = along ? tree.distanceFrom(seeds.files) : tree.distanceTo(seeds.files);
  const files = new Set(distance.keys());
  const unresolved = tree.unknownAmong(files).length;
  const holes = unresolved === 0 ? '' : ` — ${unresolved} of them import something the scan could not resolve`;
  const way = along ? 'from' : 'to';
  return {
    header: `${counted(files.size)} ${along ? 'reached from' : 'reaching'} \`${term}\`${holes}`,
    files,
    distance,
    evidence: (file) => [`${imports(distance.get(file) ?? 0)} ${way} ${term}`],
  };
}

/**
 * `spec#name`, or `spec` for every import of it. Split at the last `#` past
 * the first character, because `#internal` is itself a specifier.
 *
 * A name out of a file the tree holds is answered as `uses` answers it, off the
 * source index: a file that passes the name on with `export … from` is
 * followed, so an import through a barrel counts. Anything else — a package, a
 * specifier as written, a file with no name — is matched in the names.
 */
function importsOf(said: string, tree: Tree, names: () => SourceNames, root: string | undefined): Operand {
  const at = said.lastIndexOf('#');
  const spec = at > 0 ? said.slice(0, at) : said;
  const name = at > 0 ? said.slice(at + 1) : undefined;
  if (name === '') {
    throw new Error(`\`${said}\` has nothing after \`#\`. Say \`${spec}#name\`, or \`${spec}\` for every import of it.`);
  }
  if (name !== undefined && tree.files.has(spec)) return importersOfFile(spec, name, root);
  const held = names();
  const files = new Set<string>();
  const lines = new Map<string, string[]>();
  for (const [file, read] of held) {
    for (const entry of read.imported) {
      const module = entry.from === spec || (isBare(spec) && entry.from.startsWith(`${spec}/`)) || entry.to === spec;
      if (!module || (name !== undefined && entry.name !== name)) continue;
      files.add(file);
      const what = entry.name === undefined ? '' : `${entry.name} `;
      const as = entry.local === undefined ? '' : ` as ${entry.local}`;
      const through = entry.through === undefined ? '' : ` through ${entry.through}`;
      const list = lines.get(file) ?? [];
      list.push(`${file}:${entry.line}  imports ${what}from ${entry.from}${as}${through}`);
      lines.set(file, list);
    }
  }
  return {
    header: `${counted(files.size)} importing ${name === undefined ? '' : `\`${name}\` from `}\`${spec}\`${unreadOf(tree, held)}`,
    files,
    evidence: (file) => lines.get(file) ?? [],
  };
}

/** Every import of `name` out of `file`, followed through the files that pass it on. */
function importersOfFile(file: string, name: string, root: string | undefined): Operand {
  const read = importersOf(root, [file], name);
  if ('unread' in read) {
    throw new Error(`\`discover\` ran nothing: who imports \`${name}\` from \`${file}\` is read from the source index, and ${read.unread}.`);
  }
  const files = new Set<string>();
  const lines = new Map<string, string[]>();
  for (const use of read.uses) {
    files.add(use.at);
    const through = use.through === undefined ? '' : use.through.kind === 'dynamic' ? ' through import()' : ' through a namespace';
    const list = lines.get(use.at) ?? [];
    list.push(`${use.at}:${use.line}  imports ${use.name} from ${use.specifier}${through}`);
    lines.set(use.at, list);
  }
  const passed = read.through.length === 0 ? '' : `, through ${counted(read.through.length)} that ${read.through.length === 1 ? 'passes' : 'pass'} it on`;
  return {
    header: `${counted(files.size)} importing \`${name}\` from \`${file}\`${passed}`,
    files,
    evidence: (at) => lines.get(at) ?? [],
  };
}

function declaresOf(pattern: string, tree: Tree, names: SourceNames): Operand {
  const matches = regexOf('declares', pattern, 'i');
  const files = new Set<string>();
  const lines = new Map<string, string[]>();
  for (const [file, held] of names) {
    const declared = held.declared.filter((entry) => matches.test(entry.name));
    if (declared.length === 0) continue;
    files.add(file);
    lines.set(file, declared.map((entry) => `${file}:${entry.line}  declares ${entry.name}`));
  }
  return {
    header: `${counted(files.size)} declaring a name matching /${pattern}/i${unreadOf(tree, names)}`,
    files,
    evidence: (file) => lines.get(file) ?? [],
  };
}

function pathOf(pattern: string, tree: Tree): Operand {
  const matches = regexOf('path', pattern, '');
  const files = new Set([...tree.files].filter((file) => matches.test(file)));
  return { header: `${counted(files.size)} with a path matching /${pattern}/`, files, evidence: none };
}

/** The operands a call names, positive and taken out, in the order the schema lists them. */
function operandsOf(input: Readonly<Record<string, unknown>>, tree: Tree, names: SourceNames | undefined, root: string | undefined) {
  const named = (): SourceNames => {
    if (names !== undefined) return names;
    throw new Error(
      '`discover` ran nothing: no names were read with the source tree here, so `declares`, and ' +
        '`imports` of anything but a name out of a repository file, have nothing to answer from. Ask ' +
        '`variance ask discover` in the checkout, which reads them as it reads the tree.',
    );
  };
  const read = (prefix: '' | 'except'): Operand[] => {
    const key = (name: string): string => (prefix === '' ? name : `${prefix}${name[0]!.toUpperCase()}${name.slice(1)}`);
    const operands: Operand[] = [];
    for (const term of listArg(input, key('from'))) operands.push(reach(term, tree, true));
    for (const term of listArg(input, key('to'))) operands.push(reach(term, tree, false));
    for (const said of listArg(input, key('imports'))) operands.push(importsOf(said, tree, named, root));
    const declares = textArg(input, key('declares'));
    if (declares !== undefined) operands.push(declaresOf(declares, tree, named()));
    const path = textArg(input, key('path'));
    if (path !== undefined) operands.push(pathOf(path, tree));
    return operands;
  };
  return { kept: read(''), out: read('except') };
}

/**
 * Whether a call names an operand read off the names. A question about paths
 * alone reads the tree and nothing else: on a large checkout the names cost a
 * second read of every file for its declarations.
 */
export function readsNames(input: Readonly<Record<string, unknown>>): boolean {
  return ['imports', 'exceptImports', 'declares', 'exceptDeclares'].some((key) => input[key] !== undefined);
}

/**
 * Typed over nothing, like `grep`: the tree and the names arrive on the
 * invocation, and the text is ripgrep's.
 */
export const discover: Tool<unknown> = {
  name: 'docs_discover',
  description:
    'Answer the files that are in every one of several sets, each read whole: what a path reaches ' +
    '(`from`) or what reaches it (`to`), who imports a name (`imports`, `module#name` or `module`), ' +
    'who declares a name matching a pattern (`declares`), whose path matches one (`path`). Several ' +
    'values of one operand are several sets, crossed. `except…` operands take their files out, and ' +
    '`text` keeps only the files with a line ripgrep matches. Nearest first, with the line that puts ' +
    'each file in each set. `declares`, and `imports` of anything but `file#name`, read the names a scan ' +
    'of the checkout hands over; a host that holds none refuses them.',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'array', items: { type: 'string' }, description: 'Paths; each is the set of files it reaches along the imports, itself included. Same path forms as `search --from`.' },
      to: { type: 'array', items: { type: 'string' }, description: 'Paths; each is the set of files that reach it along the imports, itself included.' },
      imports: { type: 'array', items: { type: 'string' }, description: '`module#name` or `module`, as written in the import or as the repo-relative file it resolved to; each is the set of files importing it. A subpath of a package matches the package; a relative specifier matches only as written. `file#name` for a repo-relative file is answered as `docs_uses` answers it, from the source index: an import through a barrel that passes the name on counts.' },
      declares: { type: 'string', description: 'A regular expression, case-insensitive; the set of files declaring a matching name. An export of an imported name, with `from` or without, is declared where it comes from; `export default function make()` declares `make`.' },
      path: { type: 'string', description: 'A regular expression over repo-relative paths.' },
      text: { type: 'string', description: 'A ripgrep pattern, run only over the files every other operand kept.' },
      exceptFrom: { type: 'array', items: { type: 'string' }, description: 'As `from`, taken out.' },
      exceptTo: { type: 'array', items: { type: 'string' }, description: 'As `to`, taken out.' },
      exceptImports: { type: 'array', items: { type: 'string' }, description: 'As `imports`, taken out.' },
      exceptDeclares: { type: 'string', description: 'As `declares`, taken out.' },
      exceptPath: { type: 'string', description: 'As `path`, taken out.' },
      limit: { type: 'integer', description: `Files to show. ${SHOWN} when not said; the rest are counted.` },
    },
    additionalProperties: false,
  },

  wants: () => true,

  run: (_subject, input, invocation) => {
    const text = textArg(input, 'text');
    const tree = invocation?.tree;
    if (tree === undefined) {
      throw new Error('`discover` ran nothing: no source tree was read. Ask from a checkout of the workspace.');
    }
    const { kept, out } = operandsOf(input, tree, invocation?.names, invocation?.root);
    if (kept.length === 0) {
      throw new Error(
        text === undefined
          ? '`discover` needs at least one set to cross: `from`, `to`, `imports`, `declares` or `path`.'
          : `\`text\` searches inside the files the other sets kept, and none was given. For the whole checkout, run \`rg ${JSON.stringify(text)}\`.`,
      );
    }

    // Smallest first, so each step tests the fewest files.
    const [first, ...rest] = [...kept].sort((left, right) => left.files.size - right.files.size);
    let answer = [...first!.files].filter((file) => rest.every((operand) => operand.files.has(file)));
    answer = answer.filter((file) => !out.some((operand) => operand.files.has(file)));

    const reaches = kept.filter((operand) => operand.distance !== undefined);
    // Once per file, not per comparison: the answer is read whole and can be most of the checkout.
    const distance = new Map<string, number>();
    for (const file of answer) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const operand of reaches) nearest = Math.min(nearest, operand.distance!.get(file) ?? Number.POSITIVE_INFINITY);
      distance.set(file, nearest);
    }
    answer.sort((left, right) => distance.get(left)! - distance.get(right)! || codeUnitOrder(left, right));

    const header = [...kept.map((operand) => operand.header), ...out.map((operand) => `${operand.header}, taken out`)];

    const matched = new Map<string, string[]>();
    if (text !== undefined && answer.length > 0) {
      const { hits, errors } = ripgrep(tree.root, text, answer);
      for (const hit of [...hits].sort((left, right) => left.line - right.line)) {
        const list = matched.get(hit.file) ?? [];
        list.push(`${hit.file}:${hit.line}  ${hit.text}`);
        matched.set(hit.file, list);
      }
      header.push(`\`${text}\` matches a line in ${matched.size} of the ${answer.length === 1 ? 'one file' : counted(answer.length)} the other sets kept`);
      if (errors.length > 0) header.push(`ripgrep reported ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}; the first: ${errors[0]}`);
      answer = answer.filter((file) => matched.has(file));
    }

    if (answer.length === 0) return [...header, '', 'No file is in all of them.'].join('\n');

    const limit = limitArg(input);
    const order = reaches.length === 0 ? '.' : ', nearest first.';
    const lines = [...header, '', `${counted(answer.length)} in all of them${order}`];
    for (const file of answer.slice(0, limit)) {
      lines.push('', file);
      for (const operand of kept) for (const line of operand.evidence(file)) lines.push(`  ${line}`);
      for (const line of matched.get(file) ?? []) lines.push(`  ${line}`);
    }
    if (answer.length > limit) lines.push('', `${answer.length - limit} more not shown; a higher \`limit\` shows them.`);
    return lines.join('\n');
  },
};
