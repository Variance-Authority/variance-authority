/**
 * `docs_stack` — every package a location can already use, with no words.
 *
 * The bulk question before writing code. It reads the published dependency
 * lexicon and nothing else: no source is opened and no installed package is
 * read at question time, so the answer costs the same in a large checkout as in
 * a small one. A package is usable where the manifest that owns the path
 * declares it, the rule `search` and `symbol` already answer under.
 */

// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { dependencyStack, type DependencySkill, type Stack, type StackRow } from '../dependency-lexicon.js';

/** Rows shown when the question names no limit. */
const SHOWN = 40;

const GROUPS = {
  imported: 'Imported here',
  unused: 'Declared, not imported here',
  unread: 'Imports not read',
} as const;

function count(input: Readonly<Record<string, unknown>>, name: string, least: number, otherwise: number): number {
  const said = input[name];
  if (said === undefined) return otherwise;
  const value = typeof said === 'string' && said.trim() !== '' ? Number(said) : said;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < least) {
    throw new Error(`\`--${name}\` takes a whole number of at least ${least}; it was given \`${String(said)}\`.`);
  }
  return value;
}

function line(row: StackRow): string {
  const declared = row.declaredAs === undefined ? 'imported, not declared there' : row.declaredAs;
  const version = row.version === undefined ? ' (version not resolved)' : `@${row.version}`;
  const used =
    row.state === 'unread' ? 'imports not indexed'
    : row.state === 'unused' ? 'not imported'
    : `imported ${row.imports}× (first ${row.site ?? 'site not recorded'})`;
  return `  ${row.package}${version} · ${row.role} · ${declared} in ${row.manifest} · ${used}`;
}

/** Characters of a skill's description shown; the agent opens the SKILL.md for the rest. */
const SAYS = 160;

/** One skill a package ships, indented under the package: the file to read and the first sentence of what it is for. */
function skillLine(skill: DependencySkill): string {
  const first = skill.description?.split(/(?<=[.!?])\s/)[0];
  const says =
    skill.unreadable !== undefined ? `unreadable: ${skill.unreadable}`
    : first === undefined ? 'no description'
    : first.length > SAYS ? `${first.slice(0, SAYS - 3)}...`
    : first;
  return `    skill ${skill.name}: ${skill.at} — ${says}`;
}

/** The page as text: one header, the rows grouped as the order already keeps them, and what remains. */
export function formatStack(stack: Stack, where: string): string {
  const head =
    `${stack.total} packages usable from ${where}, under ${stack.location.join(', ')}: ` +
    `${stack.imported} imported, ${stack.unused} declared and not imported, ${stack.unread} with imports not read.`;
  if (stack.rows.length === 0) {
    return stack.total === 0 ? `${head}\nThe owning manifest declares nothing and the code imports nothing third-party.` : `${head}\nOffset ${stack.offset} is past the last row.`;
  }
  const skills =
    stack.skilled === undefined ? 'Skills were not read: the dependency lexicon predates them; run `variance index` to read them.'
    : stack.skilled === 0 ? undefined
    : `${stack.skilled} ${stack.skilled === 1 ? 'package ships' : 'packages ship'} agent skills, each listed under its package with its SKILL.md.`;
  const out: string[] = [head, ...(skills === undefined ? [] : [skills]), `Rows ${stack.offset + 1}–${stack.offset + stack.rows.length}.`];
  let group: StackRow['state'] | undefined;
  for (const row of stack.rows) {
    if (row.state !== group) {
      group = row.state;
      out.push('', `${GROUPS[group]}:`);
    }
    out.push(line(row), ...(row.skills ?? []).map(skillLine));
  }
  if (stack.unreadable.length > 0) {
    out.push('', 'Declarations that could not be read:', ...stack.unreadable.map((one) => `  ${one.package} in ${one.manifest} — ${one.reason}`));
  }
  out.push('', stack.remaining === 0 ? 'No more rows.' : `${stack.remaining} more rows; ask again with --offset ${stack.offset + stack.rows.length}.`);
  return out.join('\n');
}

export const stack: Tool<Help> = {
  name: 'docs_stack',
  description:
    'Every third-party package a location can already use, with no query: for each, its role ' +
    '(runtime, dev, types-only), how the owning manifest declares it, its version and how many ' +
    'times the code imports it. Imported packages come first, then the declared and not imported, ' +
    'then those whose imports were not read. Under a package that ships agent skills, each skill ' +
    'is named with its SKILL.md and the first sentence of its description; read that file before using ' +
    'the package. Paged in a stable order; `offset` takes the next page. ' +
    'Reads only the published dependency lexicon; nothing is opened at question time.',
  inputSchema: {
    type: 'object',
    properties: {
      from: {
        ...START_POINT_SCHEMA.from,
        description: `${START_POINT_SCHEMA.from.description} The packages usable there are the ones the manifest that owns it declares: pass the file you are editing, or the folder of the feature.`,
      },
      limit: { type: 'integer', minimum: 1, description: `Rows per page; ${SHOWN} when omitted.` },
      offset: { type: 'integer', minimum: 0, description: 'Rows to skip; the previous answer names the next one.' },
    },
    required: ['from'],
    additionalProperties: false,
  },

  run(_help, input, invocation) {
    const root = invocation?.root;
    if (root === undefined) throw new Error('`stack` reads what a checkout published, and this host named no checkout to read');
    const at = startPointArg(input, 'from');
    if (at === undefined) throw new Error('`stack` takes `--from`, the path whose manifest is asked');
    const paths = typeof at === 'string' ? [at] : [...at];
    const answer = dependencyStack(root, paths, count(input, 'offset', 0, 0), count(input, 'limit', 1, SHOWN));
    if (answer === undefined) throw new Error('the dependency lexicon is not published; run `variance index` before asking what a path can use');
    return formatStack(answer, paths.join(', '));
  },
};
