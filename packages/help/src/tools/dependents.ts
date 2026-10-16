// compass: variance-authority.report.agent-surface
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { FileSet, Link, Tool, ToolInvocation, Tree } from '@variance-authority/mcp/tools';
import type { Help, Use } from '@variance-authority/package/help';
import { importsOfName } from './uses.js';

/**
 * `docs_dependents` — what rests on a file or a name, and how it gets there.
 *
 * `docs_uses` answers who imports a name, one import away. A change does not
 * stop there: it travels by use, to whatever imports the file that used it, and
 * stops where nothing uses it. This is that walk, said as a list a reader can
 * check — every file that reaches the subject through imports, nearest first,
 * each with one shortest chain of imports as the evidence.
 *
 * ## One direction, named by the question
 *
 * Against the imports, always: from the subject to what rests on it. What the
 * subject itself rests on is `docs_grep --from`'s area and `docs_orient`'s
 * neighbourhood. A walk both ways from a hub is the whole repository, so no
 * question here takes both, and none cuts the walk short at a depth or a hub:
 * a bound on the walk would make the list a lower bound without saying where.
 * `limit` bounds the rows printed, and the rest are counted.
 *
 * ## A name starts at its imports
 *
 * Asked of a name, the first ring is the files that import that name — what
 * `docs_uses` answers, through every `export … from` that passes it on — and
 * not every file that imports the module declaring it. A barrel that re-exports
 * the name is no use of it, so a file importing a different name through the
 * same barrel is not reached. Past the first ring the walk is by file: an
 * import of a file is an import of all of it.
 *
 * ## Every import kind is walked
 *
 * A type-only import is a dependent like any other to a reader asking what
 * rests on a thing, so it is walked, and the step that took one says so.
 *
 * ## What it did not see
 *
 * A file whose imports the scan could not resolve may reach the subject
 * through the one it could not read, so the answer names such files, and is a
 * lower bound by exactly those.
 */

/** Rows shown when `limit` is not said. */
const SHOWN = 50;

/** Files of the unresolved ones named before the rest are counted. */
const NAMED = 5;

function limitArg(input: Readonly<Record<string, unknown>>): number {
  const said = input['limit'];
  return typeof said === 'number' && Number.isInteger(said) && said > 0 ? said : SHOWN;
}

function said(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** One file that reaches the subject, how many imports away, and the chain it takes. */
interface Row {
  readonly file: string;
  readonly hops: number;
  readonly chain: readonly Link[];
  /** For a name: the line in the first-ring file that imports it, and whether for types alone. */
  readonly site?: Use;
}

interface Walked {
  /** How the subject is written in the answer. */
  readonly subject: string;
  readonly rows: readonly Row[];
  /** Files that may reach the subject through an import nobody resolved. */
  readonly unseen: readonly string[];
  /** What the source index did not read, for a name. */
  readonly unread?: string;
}

const STEP: Readonly<Record<string, string>> = {
  type: 'type import',
  reexports: 're-export',
  dynamic: 'import()',
  asset: 'asset import',
};

/** A chain, the reaching file first, each step marked unless it is a plain import. */
function chainLine(row: Row, subject: string): string {
  const said = row.chain.map((link, at) => {
    const kind = link.kind === undefined || link.kind === 'imports' ? undefined : STEP[link.kind] ?? link.kind;
    return kind === undefined || at === row.chain.length - 1 ? link.file : `${link.file} (${kind})`;
  });
  if (row.site === undefined) {
    // One import away, the file and its arrow are the whole chain.
    return row.hops === 1 ? said[0]! : said.join(' → ');
  }
  const first = `${row.site.at}:${row.site.line} imports ${subject}${row.site.type ? ' (type import)' : ''}`;
  return row.hops === 1 ? first : `${said.slice(0, -1).join(' → ')} → ${first}`;
}

function walked(help: Help, input: Readonly<Record<string, unknown>>, invocation: ToolInvocation<Help> | undefined): Walked {
  const file = said(input, 'file');
  const name = said(input, 'name');
  if (file === undefined && name === undefined) {
    throw new Error('`dependents` needs a subject: `file`, a path from the root, or `name`, an exported name.');
  }
  if (file !== undefined && name !== undefined) {
    throw new Error('`dependents` takes one subject at a time: `file` or `name`, not both.');
  }
  const tree = invocation?.tree;
  if (tree === undefined) {
    throw new Error('`dependents` walks the source tree, and no source tree was read. Ask from a checkout of the workspace.');
  }

  if (file !== undefined) {
    if (!tree.files.has(file)) throw new Error(`\`${file}\` is not a file in the source tree; say a path from the root.`);
    const chains = tree.chainsTo([file]);
    const rows = [...chains.distance]
      .filter(([, hops]) => hops > 0)
      .map(([at, hops]) => ({ file: at, hops, chain: chains.chain(at) }));
    return { subject: `\`${file}\``, rows: ordered(rows), unseen: unseen(tree, [file, ...chains.distance.keys()]) };
  }

  const imports = importsOfName(help, input, invocation?.root);
  if (imports.sites.length === 0 && imports.declared.length > 0) {
    throw new Error(
      `No import names \`${imports.name}\`: it is declared without being exported, or as a member, in ${imports.declared.join(', ')}. ` +
        'Ask `dependents --file` of that file for what reaches it.',
    );
  }
  // The first line of each first-ring file stands for it; the others are the same file.
  const sites = new Map<string, Use>();
  for (const site of [...imports.sites].sort((left, right) => left.line - right.line)) {
    if (!sites.has(site.at)) sites.set(site.at, site);
  }
  const chains = tree.chainsTo(sites.keys());
  const rows: Row[] = [];
  for (const [at, site] of sites) {
    if (!chains.distance.has(at)) rows.push({ file: at, hops: 1, chain: [{ file: at }], site });
  }
  for (const [at, hops] of chains.distance) {
    const chain = chains.chain(at);
    rows.push({ file: at, hops: hops + 1, chain, site: sites.get(chain.at(-1)!.file)! });
  }
  return {
    subject: `\`${imports.name}\``,
    rows: ordered(rows),
    unseen: unseen(tree, [...sites.keys(), ...chains.distance.keys()]),
    ...(imports.unread === undefined ? {} : { unread: imports.unread }),
  };
}

/** Nearest first, then by path in code-unit order. */
function ordered(rows: readonly Row[]): readonly Row[] {
  return [...rows].sort((left, right) => left.hops - right.hops || codeUnitOrder(left.file, right.file));
}

/** Files with an unresolved import that the walk did not reach, in path order. */
function unseen(tree: Tree, reached: Iterable<string>): readonly string[] {
  const seen = new Set(reached);
  return tree.unknownAmong(tree.files).filter((file) => !seen.has(file));
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export const dependents: Tool<Help> = {
  name: 'docs_dependents',
  description:
    'Every file that reaches one file or one exported name through imports, at any depth, nearest ' +
    'first, each with one shortest chain of imports as evidence. Against the imports only: what ' +
    'rests on the subject, not what it rests on. Asked of a name, the walk starts at the files ' +
    'that import that name, as docs_uses lists them, not at every importer of its module. Every ' +
    'import kind is walked and a type-only step is marked. Files whose imports the scan could not ' +
    'resolve are named, since they may reach the subject unseen.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'The file to start from, a path from the workspace root. This or `name`.' },
      name: { type: 'string', description: 'The exported name to start from, matched exactly. This or `file`.' },
      package: { type: 'string', description: 'With `name`: only the name this package exports, by name or by specifier. Optional.' },
      limit: { type: 'integer', description: `Files to show. ${SHOWN} when not said; the rest are counted.` },
    },
    additionalProperties: false,
  },

  wants: () => true,

  run(help, input, invocation) {
    const { subject, rows, unseen: blind, unread } = walked(help, input, invocation);
    const limit = limitArg(input);
    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push(`Nothing reaches ${subject} through its imports.`);
    } else {
      lines.push(
        `${plural(rows.length, 'file')} ${rows.length === 1 ? 'reaches' : 'reach'} ${subject} through their imports, nearest first, ` +
          'each with one shortest chain. Every import kind is walked, type-only ones included.',
      );
      let heading: number | undefined;
      for (const row of rows.slice(0, limit)) {
        if (row.hops !== heading) {
          heading = row.hops;
          lines.push('', `${plural(row.hops, 'import')} away:`);
        }
        lines.push(chainLine(row, subject));
      }
      if (rows.length > limit) {
        lines.push('', `${plural(rows.length - limit, 'more file', 'more files')} not shown, the farthest ${plural(rows.at(-1)!.hops, 'import')} away; a higher \`limit\` shows them.`);
      }
    }
    if (blind.length > 0) {
      const named = blind.slice(0, NAMED).join(', ');
      const rest = blind.length > NAMED ? ` and ${blind.length - NAMED} more` : '';
      lines.push(
        '',
        `${plural(blind.length, 'file')} in the tree ${blind.length === 1 ? 'has' : 'have'} an import the scan could not resolve, ` +
          `and may reach ${subject} through ${blind.length === 1 ? 'it' : 'one'}: ${named}${rest}.`,
      );
    }
    if (unread !== undefined) lines.push('', `Imports within the package were not read: ${unread}.`);
    return lines.join('\n');
  },

  // Every file that reaches the subject, uncapped; a first-ring file of a name
  // at the line that imports it.
  files(help, input, invocation): FileSet {
    const { rows, unread } = walked(help, input, invocation);
    const files = new Map<string, readonly number[]>();
    for (const row of rows) files.set(row.file, row.site !== undefined && row.hops === 1 ? [row.site.line] : []);
    return { files, ...(unread === undefined ? {} : { unread: [`imports within the package: ${unread}`] }) };
  },
};
