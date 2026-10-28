import { extname } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { FileSet, Link, SourceNames, Tool, ToolInvocation, Tree } from '@variance-authority/mcp/tools';
import { entryPoints, limitOf, notShown, pathsOf, refusalFor, spellingOf, startPointArg } from '@variance-authority/mcp/tools';
import { READABLE } from '@variance-authority/sense';
import { ripgrep } from './ripgrep.js';
import { importsOf as importersOf, type IndexedUse } from './unpublished.js';

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
 *
 * ## What reaches a subject says how
 *
 * A change travels by use, so `to` is the question of what a change reaches,
 * and a file in it is evidence only with the imports that put it there. Each
 * file shown carries one shortest chain, built when it is shown: a crossing
 * reads the whole set, and the chain of a file nobody sees is never walked.
 * `to` a name out of a file starts where `uses` stops, at the files importing
 * the name.
 */

/** Files shown when `limit` is not said; every one is counted. */
const SHOWN = 50;

/** Why a file is in a set: what it says, at the line that says it when there is one. */
interface Evidence {
  readonly line?: number;
  readonly text: string;
}

/** One set, read whole, and how it says a file is in it. */
interface Operand {
  readonly header: string;
  readonly files: ReadonlySet<string>;
  /** Import distance from or to its start point; reach operands only. */
  readonly distance?: ReadonlyMap<string, number>;
  readonly evidence: (file: string) => readonly Evidence[];
  /**
   * The lines that put a file in the set, for a caller that prints no
   * evidence; read off `evidence` when absent. A reach says it, since its
   * evidence is a chain, which costs a walk back per file.
   */
  readonly lines?: (file: string) => readonly number[];
  /** What the set could not read, so a set short of files says so. */
  readonly unread?: string;
}

const counted = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'}`;
const imports = (count: number): string => `${count} ${count === 1 ? 'import' : 'imports'}`;
const none = (): readonly Evidence[] => [];
const said = (unread: string | undefined): string => (unread === undefined ? '' : ` — ${unread}`);

/**
 * The files a reader claims and the names do not hold: a file whose names the
 * scan could not hand over is unknown, never a file that declares and imports
 * nothing, so a name operand says how many there are. A file no reader claims,
 * a README or a manifest, has no names to read and is not counted.
 */
function unreadOf(tree: Tree, names: SourceNames): string | undefined {
  let unread = 0;
  for (const file of tree.files) if (READABLE.has(extname(file)) && !names.has(file)) unread += 1;
  return unread === 0 ? undefined : `the names of ${counted(unread)} were not read`;
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

function regexOf(name: string, pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`\`${name}\` is not a regular expression: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

/** How a step that is not a plain import is said on a chain. */
const STEP: Readonly<Record<string, string>> = {
  type: 'type import',
  reexports: 'export … from',
  dynamic: 'import()',
  asset: 'asset import',
};

/** Files of the unresolved ones named before the rest are counted. */
const NAMED = 5;

/** `a.ts → b.ts (type import) → c.ts`: each file, and the kind of the import it takes to the next. */
function chainText(links: readonly Link[]): string {
  return links
    .map((link) => (link.kind === undefined || link.kind === 'imports' ? link.file : `${link.file} (${STEP[link.kind] ?? link.kind})`))
    .join(' → ');
}

/**
 * What a walk could not see. Along the imports, a reached file whose own
 * imports were not all resolved reaches further than the set says. Against
 * them, a file the walk did not reach may import the subject through the one
 * import nobody resolved, so those are the files named.
 */
function holesOf(tree: Tree, files: ReadonlySet<string>, along: boolean): string | undefined {
  if (along) {
    const unresolved = tree.unknownAmong(files).length;
    return unresolved === 0 ? undefined : `${unresolved} of them import something the scan could not resolve`;
  }
  const unseen = tree.unknownAmong(tree.files).filter((file) => !files.has(file));
  if (unseen.length === 0) return undefined;
  const rest = unseen.length > NAMED ? ` and ${unseen.length - NAMED} more` : '';
  return (
    `${unseen.length} other ${unseen.length === 1 ? 'file imports' : 'files import'} something the scan could not resolve, ` +
    `and may reach it: ${unseen.slice(0, NAMED).join(', ')}${rest}`
  );
}

/**
 * Everything a path reaches along the imports, or everything reaching it.
 * Against the imports, `file#name` for a file the tree holds starts at the
 * imports of that name rather than at the file.
 */
function reach(term: string, tree: Tree, along: boolean, root: string | undefined): Operand {
  if (!along) {
    const named = nameOf(term);
    if (named.name !== undefined && tree.files.has(named.spec)) return reachingName(term, named.spec, named.name, tree, root);
  }
  const seeds = entryPoints([term], tree);
  const refused = refusalFor(seeds.unmatched);
  if (refused !== undefined) {
    throw new Error(
      `\`discover\` ran nothing: ${refused}. Say a real path from the root — \`src/a/File.ts\` is ` +
        "that file, `src/a/*` its folder's own files, `src/a/` everything under it.",
    );
  }
  // Against the imports the walk keeps its parent pointers, so a file shown can say how it gets there.
  const chains = along ? undefined : tree.chainsTo(seeds.files);
  const distance = chains?.distance ?? tree.distanceFrom(seeds.files);
  const files = new Set(distance.keys());
  const holes = holesOf(tree, files, along);
  const way = along ? 'from' : 'to';
  return {
    header: `${counted(files.size)} ${along ? 'reached from' : 'reaching'} \`${term}\`${said(holes)}`,
    files,
    distance,
    evidence: (file) => {
      const hops = distance.get(file) ?? 0;
      const chain = chains !== undefined && hops > 1 ? `: ${chainText(chains.chain(file))}` : '';
      return [{ text: `${imports(hops)} ${way} ${term}${chain}` }];
    },
    lines: () => [],
    ...(holes === undefined ? {} : { unread: holes }),
  };
}

/**
 * What rests on one name out of a file: the files that import it, read off the
 * source index as `uses` reads them, through every `export … from` that passes
 * it on, then whatever reaches those files. A barrel is no use of the name, so
 * a file importing another name through it is not reached; past the files that
 * import the name the walk is by file, since an import of a file is an import
 * of all of it.
 */
function reachingName(term: string, file: string, name: string, tree: Tree, root: string | undefined): Operand {
  const read = importersOf(root, [file], name);
  if ('unread' in read) {
    throw new Error(`\`discover\` ran nothing: what imports \`${name}\` from \`${file}\` is read from the source index, and ${read.unread}.`);
  }
  const sites = sitesOf(read.uses);
  const chains = tree.chainsTo(sites.keys());
  const distance = new Map<string, number>([[file, 0]]);
  for (const [at, hops] of chains.distance) if (!distance.has(at)) distance.set(at, hops + 1);
  const files = new Set(distance.keys());
  const holes = holesOf(tree, files, false);
  return {
    header: `${counted(files.size)} reaching \`${name}\` from \`${file}\`${passedOn(read.through)}${said(holes)}`,
    files,
    distance,
    evidence: (at) => {
      const hops = distance.get(at) ?? 0;
      if (hops === 0) return [{ text: `0 imports to ${term}` }];
      if (hops === 1) return sites.get(at) ?? [];
      const chain = chains.chain(at);
      const seed = chain.at(-1)!.file;
      const site = sites.get(seed)![0]!;
      return [{ text: `${imports(hops)} to ${term}: ${chainText(chain.slice(0, -1))} → ${seed}:${site.line} ${site.text}` }];
    },
    lines: (at) => (distance.get(at) === 1 ? (sites.get(at) ?? []).flatMap((site) => (site.line === undefined ? [] : [site.line])) : []),
    ...(holes === undefined ? {} : { unread: holes }),
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
function importsOf(written: string, tree: Tree, names: () => SourceNames, root: string | undefined): Operand {
  const { spec, name } = nameOf(written);
  if (name !== undefined && tree.files.has(spec)) return importersOfFile(spec, name, root);
  const held = names();
  const files = new Set<string>();
  const lines = new Map<string, Evidence[]>();
  for (const [file, read] of held) {
    for (const entry of read.imported) {
      const module = entry.from === spec || (isBare(spec) && entry.from.startsWith(`${spec}/`)) || entry.to === spec;
      if (!module || (name !== undefined && entry.name !== name)) continue;
      files.add(file);
      const what = entry.name === undefined ? '' : `${entry.name} `;
      const as = entry.local === undefined ? '' : ` as ${entry.local}`;
      const through = entry.through === undefined ? '' : ` through ${entry.through}`;
      const list = lines.get(file) ?? [];
      list.push({ line: entry.line, text: `imports ${what}from ${entry.from}${as}${through}` });
      lines.set(file, list);
    }
  }
  const unread = unreadOf(tree, held);
  return {
    header: `${counted(files.size)} importing ${name === undefined ? '' : `\`${name}\` from `}\`${spec}\`${said(unread)}`,
    files,
    evidence: (file) => lines.get(file) ?? [],
    ...(unread === undefined ? {} : { unread }),
  };
}

/** Every import of `name` out of `file`, followed through the files that pass it on. */
function importersOfFile(file: string, name: string, root: string | undefined): Operand {
  const read = importersOf(root, [file], name);
  if ('unread' in read) {
    throw new Error(`\`discover\` ran nothing: who imports \`${name}\` from \`${file}\` is read from the source index, and ${read.unread}.`);
  }
  const lines = sitesOf(read.uses);
  return {
    header: `${counted(lines.size)} importing \`${name}\` from \`${file}\`${passedOn(read.through)}`,
    files: new Set(lines.keys()),
    evidence: (at) => lines.get(at) ?? [],
  };
}

/** `spec#name`, split at the last `#` past the first character; a `#` with nothing after it is refused. */
function nameOf(written: string): { readonly spec: string; readonly name: string | undefined } {
  const at = written.lastIndexOf('#');
  const spec = at > 0 ? written.slice(0, at) : written;
  const name = at > 0 ? written.slice(at + 1) : undefined;
  if (name === '') {
    throw new Error(`\`${written}\` has nothing after \`#\`. Say \`${spec}#name\`, or \`${spec}\` for every import of it.`);
  }
  return { spec, name };
}

/** Each importing file, and the lines on which it imports the name, in the order the index holds them. */
function sitesOf(uses: readonly IndexedUse[]): ReadonlyMap<string, readonly Evidence[]> {
  const lines = new Map<string, Evidence[]>();
  for (const use of uses) {
    const through = use.through === undefined ? '' : use.through.kind === 'dynamic' ? ' through import()' : ' through a namespace';
    const off = use.through?.throughDefault === true ? ', through `default`: may read it' : '';
    const whole = use.through?.whole === true ? ', passed on whole: may read it' : '';
    const list = lines.get(use.at) ?? [];
    list.push({ line: use.line, text: `imports ${use.name} from ${use.specifier}${through}${off}${whole}` });
    lines.set(use.at, list);
  }
  return lines;
}

/** `, through 2 files that pass it on`, or nothing when no file did. */
function passedOn(through: readonly string[]): string {
  return through.length === 0 ? '' : `, through ${counted(through.length)} that ${through.length === 1 ? 'passes' : 'pass'} it on`;
}

function declaresOf(pattern: string, tree: Tree, names: SourceNames): Operand {
  const matches = regexOf('declares', pattern, 'i');
  const files = new Set<string>();
  const lines = new Map<string, Evidence[]>();
  for (const [file, held] of names) {
    const declared = held.declared.filter((entry) => matches.test(entry.name));
    if (declared.length === 0) continue;
    files.add(file);
    lines.set(file, declared.map((entry) => ({ line: entry.line, text: `declares ${entry.name}` })));
  }
  const unread = unreadOf(tree, names);
  return {
    header: `${counted(files.size)} declaring a name matching /${pattern}/i${said(unread)}`,
    files,
    evidence: (file) => lines.get(file) ?? [],
    ...(unread === undefined ? {} : { unread }),
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
    for (const term of listArg(input, key('from'))) operands.push(reach(term, tree, true, root));
    for (const term of listArg(input, key('to'))) operands.push(reach(term, tree, false, root));
    for (const written of listArg(input, key('imports'))) operands.push(importsOf(written, tree, named, root));
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
  // Read as `operandsOf` reads them, so a set said empty costs no names.
  return ['imports', 'exceptImports'].some((key) => listArg(input, key).length > 0) ||
    ['declares', 'exceptDeclares'].some((key) => textArg(input, key) !== undefined);
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
      to: { type: 'array', items: { type: 'string' }, description: 'Paths; each is the set of files that reach it along the imports, every kind of import walked, itself included, and each file shown carries one shortest chain of imports to it. `file#name` for a repo-relative file starts at the imports of that name, as `docs_uses` reads them from the source index, so a file importing another name through the same barrel is not reached.' },
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
    const spell = spellingOf(invocation);
    const limit = limitOf(input, SHOWN, spell);
    const { kept, header, answer, matched, reaches } = answered(input, invocation);
    if (answer.length === 0) return [...header, '', 'No file is in all of them.'].join('\n');

    const shown = (file: string, evidence: Evidence): string => `  ${evidence.line === undefined ? '' : `${file}:${evidence.line}  `}${evidence.text}`;
    const order = reaches === 0 ? '.' : ', nearest first.';
    const lines = [...header, '', `${counted(answer.length)} in all of them${order}`];
    for (const file of answer.slice(0, limit)) {
      lines.push('', file);
      for (const operand of kept) for (const evidence of operand.evidence(file)) lines.push(shown(file, evidence));
      for (const evidence of matched.get(file) ?? []) lines.push(shown(file, evidence));
    }
    if (answer.length > limit) lines.push('', notShown(answer.length - limit, spell));
    return lines.join('\n');
  },

  // Every file in all of the sets, at each line that put it in one; what any
  // set could not read is said, so a crossing short of files is not complete.
  files: (_subject, input, invocation): FileSet => {
    const { kept, answer, matched, unread } = answered(input, invocation);
    const files = new Map<string, readonly number[]>();
    const linesOf = (operand: Operand, file: string): readonly number[] =>
      operand.lines?.(file) ?? operand.evidence(file).flatMap((one) => (one.line === undefined ? [] : [one.line]));
    for (const file of answer) {
      const said = (matched.get(file) ?? []).flatMap((one) => (one.line === undefined ? [] : [one.line]));
      const lines = [...new Set([...kept.flatMap((operand) => linesOf(operand, file)), ...said])];
      files.set(file, lines.sort((left, right) => left - right));
    }
    return { files, ...(unread.length === 0 ? {} : { unread }) };
  },
};

/** The files in every kept set and in no set taken out, nearest first, or the refusal. */
function answered(input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<unknown> | undefined) {
  const text = textArg(input, 'text');
  const tree = invocation?.tree;
  if (tree === undefined) {
    throw new Error('`discover` ran nothing: no source tree was read. Ask from a checkout of the workspace.');
  }
  const { kept, out } = operandsOf(input, tree, invocation?.names, invocation?.root);
  if (kept.length === 0) {
    const spell = spellingOf(invocation);
    const sets = ['from', 'to', 'imports', 'declares'].map((name) => `\`${spell.input(name)}\``).join(', ');
    throw new Error(
      text === undefined
        ? `\`discover\` needs at least one set to cross: ${sets} or \`${spell.input('path')}\`.`
        : `\`${spell.input('text')}\` searches inside the files the other sets kept, and none was given. For the whole checkout, run \`rg ${JSON.stringify(text)}\`.`,
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
  const unread = [...kept, ...out].flatMap((operand) => (operand.unread === undefined ? [] : [operand.unread]));

  const matched = new Map<string, Evidence[]>();
  if (text !== undefined && answer.length > 0) {
    const { hits, errors } = ripgrep(tree.root, text, answer);
    for (const hit of [...hits].sort((left, right) => left.line - right.line)) {
      const list = matched.get(hit.file) ?? [];
      list.push({ line: hit.line, text: hit.text });
      matched.set(hit.file, list);
    }
    header.push(`\`${text}\` matches a line in ${matched.size} of the ${answer.length === 1 ? 'one file' : counted(answer.length)} the other sets kept`);
    if (errors.length > 0) header.push(`ripgrep reported ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}; the first: ${errors[0]}`);
    unread.push(...errors.map((error) => `ripgrep: ${error}`));
    answer = answer.filter((file) => matched.has(file));
  }
  return { kept, header, answer, matched, reaches: reaches.length, unread };
}
