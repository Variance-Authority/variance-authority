import { codeUnitOrder } from '@variance-authority/core/segment';
import type { FileSet, Link, Tool, ToolInvocation, Tree } from '@variance-authority/mcp/tools';
import { entryPoints, nextPage, pageAt, pageOf, paged, refusalFor, spellingOf } from '@variance-authority/mcp/tools';
import type { NameHit } from '@variance-authority/sense';
import { startPointNeeded } from './area.js';
import { atLine, chainsEnd, ownSteps } from './format.js';
import { foundOf, type Found } from './discover-names.js';
import { fileNamed, listArg, nameOf, textArg } from './discover-operands.js';
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
 * the checkout. So `text` alone is refused with how to say a start point.
 *
 * ## Names are read where they lie
 *
 * `declares`, and `imports` of a package or a specifier as written, are asked
 * of the source index the tree came from in one native pass over every file's
 * parse: each name is compared where the index holds it, and only a file that
 * matches comes back. A name out of a file the tree holds is read off the
 * source index, as `uses` reads it.
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

/** A file's distance from a reach operand's start point, and the chain that walks it, when there is one. */
interface Reach {
  readonly hops: number;
  readonly steps?: readonly string[];
}

/** One set, read whole, and how it says a file is in it. */
interface Operand {
  readonly header: string;
  /** The walk a reach operand's header names after its count, `reaching \`x\``; reach operands only. */
  readonly said?: string;
  readonly files: ReadonlySet<string>;
  /** Import distance from or to its start point; reach operands only. */
  readonly distance?: ReadonlyMap<string, number>;
  readonly evidence: (file: string) => readonly Evidence[];
  /**
   * How far a file is from the start point, and against the imports the steps
   * that take it there, the file itself first; reach operands only. Asked only
   * of the files a page shows, since a chain costs a walk back per file.
   */
  readonly reach?: (file: string) => Reach;
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
const none = (): readonly Evidence[] => [];

/**
 * The files the tree holds whose names the index does not: a file whose parse
 * the scan could not hand over is unknown, never a file that declares and
 * imports nothing, so a name operand says how many there are. A file no reader
 * claims, a README or a manifest, has no names to read and is not counted.
 */
function unreadOf(tree: Tree, found: Found): string | undefined {
  let unread = 0;
  for (const file of found.unread) if (tree.has(file)) unread += 1;
  return unread === 0 ? undefined : `the names of ${counted(unread)} were not read`;
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

/** `a.ts`, `b.ts (type import)`, `c.ts`: each file, and the kind of the import it takes to the next. */
function chainSteps(links: readonly Link[]): readonly string[] {
  return links.map((link) => (link.kind === undefined || link.kind === 'imports' ? link.file : `${link.file} (${STEP[link.kind] ?? link.kind})`));
}

/**
 * What a walk could not see. Along the imports, a reached file whose own
 * imports were not all resolved reaches further than the set says. Against
 * them, a file the walk did not reach may import the subject through the one
 * import nobody resolved, so those are the files named.
 */
function holesOf(tree: Tree, files: ReadonlySet<string>, along: boolean, said: string): string | undefined {
  if (along) {
    const unresolved = tree.unknownAmong(files).length;
    const which = unresolved === 1 ? 'file' : 'files';
    return unresolved === 0 ? undefined : `${unresolved} ${which} ${said} import something the scan could not resolve`;
  }
  const unseen = tree.unknownFiles().filter((file) => !files.has(file));
  if (unseen.length === 0) return undefined;
  const rest = unseen.length > NAMED ? ` and ${unseen.length - NAMED} more` : '';
  return (
    `${unseen.length} other ${unseen.length === 1 ? 'file imports' : 'files import'} something the scan could not resolve, ` +
    `and may be ${said}: ${unseen.slice(0, NAMED).join(', ')}${rest}`
  );
}

/**
 * Everything a path reaches along the imports, or everything reaching it.
 * Against the imports, `file#name` for a file the tree holds starts at the
 * imports of that name rather than at the file.
 */
function reach(term: string, tree: Tree, along: boolean, root: string | undefined, out: boolean): Operand {
  if (!along) {
    const named = nameOf(term);
    if (named.name !== undefined && tree.has(named.spec)) return reachingName(term, named.spec, named.name, tree, root, out);
  }
  const seeds = entryPoints([term], tree);
  const refused = refusalFor(seeds.unmatched, tree.root);
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
  const said = `${along ? 'reached from' : 'reaching'} \`${term}\``;
  const holes = holesOf(tree, files, along, out ? `${said}, which is taken out` : said);
  return {
    header: `${counted(files.size)} ${said}`,
    said,
    files,
    distance,
    evidence: none,
    reach: (file) => {
      const hops = distance.get(file) ?? 0;
      return chains !== undefined && hops > 1 ? { hops, steps: chainSteps(chains.chain(file)) } : { hops };
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
function reachingName(term: string, file: string, name: string, tree: Tree, root: string | undefined, out: boolean): Operand {
  const read = importersOf(root, [file], name);
  if ('unread' in read) {
    throw new Error(`\`discover\` ran nothing: what imports \`${name}\` from \`${file}\` is read from the source index, and ${read.unread}.`);
  }
  const sites = sitesOf(read.uses);
  const chains = tree.chainsTo(sites.keys());
  const distance = new Map<string, number>([[file, 0]]);
  for (const [at, hops] of chains.distance) if (!distance.has(at)) distance.set(at, hops + 1);
  const files = new Set(distance.keys());
  const said = `reaching \`${name}\` from \`${file}\`${passedOn(read.through)}`;
  const holes = holesOf(tree, files, false, out ? `${said}, which is taken out` : said);
  return {
    header: `${counted(files.size)} ${said}`,
    said,
    files,
    distance,
    evidence: (at) => (distance.get(at) === 1 ? (sites.get(at) ?? []) : []),
    reach: (at) => {
      const hops = distance.get(at) ?? 0;
      if (hops <= 1) return { hops };
      const chain = chains.chain(at);
      const seed = chain.at(-1)!.file;
      const site = sites.get(seed)![0]!;
      return { hops, steps: [...chainSteps(chain.slice(0, -1)), `${seed}:${site.line} ${site.text}`] };
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
function importsOf(written: string, tree: Tree, found: () => Found, root: string | undefined): Operand {
  const named = fileNamed(written, tree);
  if (named !== undefined) return importersOfFile(named.file, named.name, root);
  const { spec, name } = nameOf(written);
  const held = found();
  const lines = linesOf(held.imports.shift()!, held, (hit) => {
    const as = hit.local == null ? '' : ` as ${hit.local}`;
    const through = hit.through == null ? '' : ` through ${hit.through}`;
    return `imports ${hit.name == null ? '' : `${hit.name} `}from ${hit.from}${as}${through}`;
  });
  return namedOperand(`importing ${name === undefined ? '' : `\`${name}\` from `}\`${spec}\``, lines, tree, held);
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

function declaresOf(pattern: string, tree: Tree, found: Found): Operand {
  const asked = found.declares.shift()!;
  if (asked.refused != null) throw new Error(`\`declares\` is not a regular expression the source index reads: ${asked.refused}.`);
  return namedOperand(`declaring a name matching /${pattern}/i`, linesOf(asked.hits, found, (hit) => `declares ${hit.name}`), tree, found);
}

/** A name set's operand: its files, their lines, and the files whose names the index does not hold. */
function namedOperand(what: string, lines: ReadonlyMap<string, readonly Evidence[]>, tree: Tree, found: Found): Operand {
  const unread = unreadOf(tree, found);
  return {
    header: `${counted(lines.size)} ${what}`,
    files: new Set(lines.keys()),
    evidence: (file) => lines.get(file) ?? [],
    ...(unread === undefined ? {} : { unread }),
  };
}

/** Each file's lines, spelled as the tree spells it. */
function linesOf(hits: readonly NameHit[], found: Found, text: (hit: NameHit) => string): ReadonlyMap<string, readonly Evidence[]> {
  const lines = new Map<string, Evidence[]>();
  for (const hit of hits) {
    const file = found.spelled(hit.file);
    const list = lines.get(file) ?? [];
    list.push({ line: hit.line, text: text(hit) });
    lines.set(file, list);
  }
  return lines;
}

function pathOf(pattern: string, tree: Tree): Operand {
  const matches = regexOf('path', pattern, '');
  const files = new Set<string>();
  for (const file of tree.files()) if (matches.test(file)) files.add(file);
  return { header: `${counted(files.size)} with a path matching /${pattern}/`, files, evidence: none };
}

/** The operands a call names, positive and taken out, in the order the schema lists them. */
function operandsOf(input: Readonly<Record<string, unknown>>, tree: Tree, invocation: ToolInvocation<unknown> | undefined) {
  const root = invocation?.root;
  let held: Found | undefined;
  const found = (): Found => (held ??= foundOf(input, tree, invocation));
  const read = (prefix: '' | 'except'): Operand[] => {
    const key = (name: string): string => (prefix === '' ? name : `${prefix}${name[0]!.toUpperCase()}${name.slice(1)}`);
    const operands: Operand[] = [];
    for (const term of listArg(input, key('from'))) operands.push(reach(term, tree, true, root, prefix !== ''));
    for (const term of listArg(input, key('to'))) operands.push(reach(term, tree, false, root, prefix !== ''));
    for (const written of listArg(input, key('imports'))) operands.push(importsOf(written, tree, found, root));
    const declares = textArg(input, key('declares'));
    if (declares !== undefined) operands.push(declaresOf(declares, tree, found()));
    const path = textArg(input, key('path'));
    if (path !== undefined) operands.push(pathOf(path, tree));
    return operands;
  };
  return { kept: read(''), out: read('except') };
}

/**
 * Typed over nothing, like `grep`: the tree arrives on the invocation, the
 * names are the source index's, and the text is ripgrep's.
 */
export const discover: Tool<unknown> = {
  name: 'docs_discover',
  description:
    'The files in every one of several sets, nearest first, each with the line that puts it in each ' +
    'set. A set is what a path imports (`from`) or what imports it (`to`), the files importing a ' +
    'module or name (`imports`), declaring a matching name (`declares`), or whose path matches ' +
    '(`path`); several values of one operand are several sets. `except…` operands take files out, and ' +
    '`text` keeps the files with a ripgrep match. `declares` and `imports` read the source index. Use docs_intersection to cross whole questions ' +
    'instead.',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'array', items: { type: 'string' }, description: 'Paths, in `search`\'s forms (`x/` and `x/*` for folders); each the files it imports, itself included.' },
      to: { type: 'array', items: { type: 'string' }, description: 'Paths, as `from`; each the files importing it, itself included. `file#name` starts at that name\'s imports.' },
      imports: { type: 'array', items: { type: 'string' }, description: '`module#name` or `module`, as written or as the file it resolves to; each the files importing it.' },
      declares: { type: 'string', description: 'A Rust `regex` (no lookaround or backreferences), case-insensitive; the files declaring a matching name. `export default function make()` declares `make`.' },
      path: { type: 'string', description: 'A regular expression over repo-relative paths.' },
      text: { type: 'string', description: 'A ripgrep pattern over the files the other operands kept.' },
      exceptFrom: { type: 'array', items: { type: 'string' }, description: 'As `from`, taken out.' },
      exceptTo: { type: 'array', items: { type: 'string' }, description: 'As `to`, taken out.' },
      exceptImports: { type: 'array', items: { type: 'string' }, description: 'As `imports`, taken out.' },
      exceptDeclares: { type: 'string', description: 'As `declares`, taken out.' },
      exceptPath: { type: 'string', description: 'As `path`, taken out.' },
      limit: { type: 'integer', description: `Files to show, the rest counted; ${SHOWN} when not said.` },
      offset: { type: 'integer', minimum: 0, description: 'Rows to skip, 0 when not said; an answer with more names the next.' },
    },
    additionalProperties: false,
  },

  wants: () => true,

  run: (_subject, input, invocation) => {
    const spell = spellingOf(invocation);
    const page = pageOf(input, SHOWN, spell);
    const { kept, header, answer, matched, notes } = answered(input, invocation);
    const noted = notes.map((note) => `note: ${note}`);
    if (answer.length === 0) return ['No file is in all of them:', ...header.map((said) => `- ${said}`), ...noted].join('\n');
    return [...rowsOf(kept, header, answer, matched, page, spell), ...noted, ...nextPage(page, answer.length, spell)].join('\n');
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
  const { kept, out } = operandsOf(input, tree, invocation);
  if (kept.length === 0) {
    const spell = spellingOf(invocation);
    const sets = ['from', 'to', 'imports', 'declares'].map((name) => `\`${spell.input(name)}\``).join(', ');
    throw new Error(
      text === undefined
        ? `\`discover\` needs at least one set to cross: ${sets} or \`${spell.input('path')}\`.`
        : `\`${spell.input('text')}\` searches inside the files the other sets kept, and none was given. ${startPointNeeded(invocation)}`,
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
  // One index answers every name set, so a note two sets share is said once.
  const notes = [...new Set([...kept, ...out].flatMap((operand) => (operand.unread === undefined ? [] : [operand.unread])))];
  const unread = [...notes];

  const matched = new Map<string, Evidence[]>();
  if (text !== undefined && answer.length > 0) {
    const { hits, errors } = ripgrep(tree.root, text, answer);
    for (const hit of [...hits].sort((left, right) => left.line - right.line)) {
      const list = matched.get(hit.file) ?? [];
      list.push({ line: hit.line, text: hit.text });
      matched.set(hit.file, list);
    }
    header.push(`\`${text}\` matches a line in ${matched.size} of the ${answer.length === 1 ? 'one file' : counted(answer.length)} the other sets kept`);
    if (errors.length > 0) notes.push(`ripgrep reported ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}; the first: ${errors[0]}`);
    unread.push(...errors.map((error) => `ripgrep: ${error}`));
    answer = answer.filter((file) => matched.has(file));
  }
  return { kept, header, answer, matched, unread, notes };
}

/**
 * The answer first, then the sets it crossed, then one line per file: its
 * distance from each reach operand's start point, its path, or the steps of
 * its chain short of the run every chain on the page ends with, which is said
 * once above the rows. The lines that put a file in a set follow it, indented.
 */
function rowsOf(
  kept: readonly Operand[],
  header: readonly string[],
  answer: readonly string[],
  matched: ReadonlyMap<string, readonly Evidence[]>,
  page: ReturnType<typeof pageOf>,
  spell: ReturnType<typeof spellingOf>,
): readonly string[] {
  const reaches = kept.filter((operand) => operand.reach !== undefined);
  const shown = paged(answer, page).map((file) => ({ file, reached: reaches.map((operand) => operand.reach!(file)) }));
  const ends = reaches.map((_, at) => chainsEnd(shown.flatMap(({ reached }) => (reached[at]!.steps === undefined ? [] : [reached[at]!.steps!]))));
  const chained = reaches.flatMap((operand, at) => (shown.some(({ reached }) => reached[at]!.steps !== undefined) ? [at] : []));

  const lines = [
    `${counted(answer.length)} in all of them${reaches.length === 0 ? ':' : ', nearest first:'}`,
    ...header.map((said) => `- ${said}`),
    ...(reaches.length === 0 ? [] : [`each row: imports ${reaches.map((operand) => operand.said!).join(', then ')}`]),
    ...ends.flatMap((end, at) => (end.length === 0 ? [] : [`chains ${chained.length > 1 ? `${reaches[at]!.said!} ` : ''}end: ${end.join(' → ')}`])),
    ...pageAt(page, answer.length, spell),
  ];
  for (const { file, reached } of shown) {
    const hops = reached.map((one) => `${one.hops} `).join('');
    const inline = chained.length === 1 ? reached[chained[0]!]!.steps : undefined;
    lines.push(`${hops}${inline === undefined ? file : ownSteps(inline, ends[chained[0]!]!)}`);
    if (chained.length > 1) {
      for (const at of chained) if (reached[at]!.steps !== undefined) lines.push(`  → ${ownSteps(reached[at]!.steps!, ends[at]!)}`);
    }
    const evidence = [...kept.flatMap((operand) => operand.evidence(file)), ...(matched.get(file) ?? [])];
    for (const one of evidence) lines.push(`  ${one.line === undefined ? one.text : atLine(one.line, one.text)}`);
  }
  return lines;
}
