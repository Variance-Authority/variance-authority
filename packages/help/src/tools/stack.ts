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
import { START_POINT_SCHEMA, nextPage, pageAt, pageOf, spellingOf, startPointArg, type Page, type Spelling } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { dependencyStack, type DependencySkill, type Stack, type StackRow } from '../dependency-lexicon.js';
import { firstSentence } from './held-sentence.js';

/** Rows shown when the question names no limit. */
const SHOWN = 40;

const GROUPS = {
  imported: 'Imported here',
  unused: 'Declared, not imported here',
  unread: 'Imports not read',
} as const;

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
  const first = skill.description === undefined ? undefined : firstSentence(skill.description);
  const says =
    skill.unreadable !== undefined ? `unreadable: ${skill.unreadable}`
    : first === undefined ? 'no description'
    : first.length > SAYS ? `${first.slice(0, SAYS - 3)}...`
    : first;
  return `    skill ${skill.name}: ${skill.at} — ${says}`;
}

/** The page as text: one header, the rows grouped as the order already keeps them, and what remains. */
export function formatStack(stack: Stack, where: string, page: Page, spell: Spelling): string {
  const head =
    `${stack.total} packages usable from ${where}, under ${stack.location.join(', ')}: ` +
    `${stack.imported} imported, ${stack.unused} declared and not imported, ${stack.unread} with imports not read.`;
  if (stack.total === 0) return `${head}\nThe owning manifest declares nothing and the code imports nothing third-party.`;
  if (stack.rows.length === 0) return [head, ...pageAt(page, stack.total, spell)].join('\n');
  const skills = stack.skilled === 0 ? undefined : `${stack.skilled} ${stack.skilled === 1 ? 'package ships' : 'packages ship'} agent skills, each listed under its package with its SKILL.md.`;
  const out: string[] = [head, ...(skills === undefined ? [] : [skills]), ...pageAt(page, stack.total, spell)];
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
  for (const next of nextPage(page, stack.total, spell)) out.push('', next);
  return out.join('\n');
}

export const stack: Tool<Help> = {
  name: 'docs_stack',
  description:
    'The third-party packages a location can already use: for each, its role (runtime, dev, ' +
    'types-only), how the owning manifest declares it, its version and how often the code imports it, ' +
    'imported packages first, from the published dependency lexicon. A package that ships agent skills names each skill\'s SKILL.md: read it ' +
    'before using the package. Use docs_symbol with `from` for ' +
    'one installed name\'s signature there.',
  inputSchema: {
    type: 'object',
    properties: {
      from: {
        ...START_POINT_SCHEMA.from,
        description: `${START_POINT_SCHEMA.from.description} The manifest owning it decides what is usable: pass the file you are editing.`,
      },
      limit: { type: 'integer', minimum: 1, description: `Rows per page; ${SHOWN} when not said.` },
      offset: { type: 'integer', minimum: 0, description: 'Rows to skip, 0 when not said; an answer with more names the next.' },
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
    const spell = spellingOf(invocation);
    const page = pageOf(input, SHOWN, spell);
    const answer = dependencyStack(root, paths, page.offset, page.limit);
    if (answer === undefined) throw new Error('the dependency lexicon is not published; run `variance index` before asking what a path can use');
    return formatStack(answer, paths.join(', '), page, spell);
  },
};
