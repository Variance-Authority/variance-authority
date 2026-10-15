// compass: variance-authority.reach.relations

import { tsconfigUse, TypescriptError, type TsconfigUse } from '@variance-authority/sense';

/**
 * Whether the `tsconfig` a scan reads asks anything of a resolution.
 *
 * Every scan finds and reads the config that governs each file it opens, for
 * the conditions it adds and the `paths` it maps. A repository whose tracked
 * configs do neither pays for that and gains no edge, and `typescript.tsconfig:
 * false` in the root config stops it. The configs read are the tracked ones
 * that can govern the directory doctor runs in, and the setting reaches the
 * whole repository, so the choice stays the repository's: a config outside git,
 * or a base read through a package's `exports`, is not seen here. This reports
 * and suggests, and never moves the exit code. Turned off while a tracked config asks for either, every import
 * that reaches its target only through one has no edge, and it says so.
 */

export type TypescriptFinding = TsconfigUse | { readonly refused: string };

export function typescriptFinding(root: string): TypescriptFinding {
  try {
    return tsconfigUse(root);
  } catch (error) {
    if (error instanceof TypescriptError) return { refused: error.message };
    throw error;
  }
}

export function formatTypescript(finding: TypescriptFinding): readonly string[] {
  if ('refused' in finding) return ['typescript: REFUSED', `  ${finding.refused}`];
  const lines = [`typescript: tsconfig ${headline(finding.declared)}`];
  if (finding.configs === undefined) {
    return [...lines, '  not a git checkout, so no tracked config was read'];
  }
  const { under, configs, conditioned, mapped } = finding;
  lines.push(
    `  ${configs.length} tracked tsconfig ${configs.length === 1 ? 'file' : 'files'}; ` +
      `${conditioned.length} ${conditioned.length === 1 ? 'adds' : 'add'} conditions, ` +
      `${mapped.length} ${mapped.length === 1 ? 'maps' : 'map'} paths; ` +
      `read for ${under === '' ? 'the whole repository' : `${under} and every directory above it`}`,
  );
  const conditions = new Set(conditioned);
  const paths = new Set(mapped);
  const asking = configs.flatMap((file) => {
    const asks = [conditions.has(file) ? 'customConditions' : '', paths.has(file) ? 'paths' : ''].filter(Boolean);
    return asks.length === 0 ? [] : [`  ${file}: ${asks.join(', ')}`];
  });
  lines.push(...asking.slice(0, LISTED), ...(asking.length > LISTED ? [`  and ${asking.length - LISTED} more`] : []));
  const asked = asking.length > 0;
  if (finding.declared === false && asked) {
    lines.push('  no scan reads them, so an import that reaches its target only through one has no edge');
  } else if (finding.declared !== false && !asked) {
    lines.push(
      '  reading them changes no edge; `"typescript": { "tsconfig": false }` in the root ' +
        'variance.config.json stops every scan looking for one',
    );
    if (under !== '') lines.push('  it applies to the whole repository, so run this from each directory a scan reads first');
  }
  return lines;
}

/** The configs named one per line; a monorepo has thousands, and the count says the rest. */
const LISTED = 10;

function headline(declared: TsconfigUse['declared']): string {
  if (declared === undefined) return 'auto, the default';
  return declared === false ? 'off' : declared;
}
