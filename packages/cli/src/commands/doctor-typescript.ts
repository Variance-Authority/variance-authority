// compass: variance-authority.reach.relations

import { tsconfigUse, TypescriptError, type TsconfigUse } from '@variance-authority/sense';

/**
 * Whether the `tsconfig` a scan reads asks anything of a resolution.
 *
 * Every scan finds and reads the config that governs each file it opens, for
 * the conditions it adds, the `paths` it maps and the `baseUrl` it resolves
 * bare specifiers through. A repository whose configs do none of these pays for that and gains no resolved import, and `typescript.tsconfig:
 * false` in the root config stops it. The setting reaches the whole
 * repository, so the suggestion is made only when no config the listing holds
 * asks; the configs that can govern the directory doctor runs in are counted
 * apart, so a product inside a monorepo sees what it would lose and what the
 * others would. A base read through a package's `exports` is not seen here.
 * This reports and suggests, and never moves the exit code. Turned off while a
 * config asks for either, every import that reaches its target only through
 * one is not resolved, and it says so.
 */

export type TypescriptFinding = TsconfigUse | { readonly refused: string };

export async function typescriptFinding(root: string): Promise<TypescriptFinding> {
  try {
    return await tsconfigUse(root);
  } catch (error) {
    if (error instanceof TypescriptError) return { refused: error.message };
    throw error;
  }
}

export function formatTypescript(finding: TypescriptFinding): readonly string[] {
  if ('refused' in finding) return ['typescript: REFUSED', `  ${finding.refused}`];
  const lines = [`typescript: tsconfig ${headline(finding.declared)}`];
  if (finding.configs === undefined) {
    return [...lines, '  git gave no listing here, so no config was read'];
  }
  const { under, configs, conditioned, mapped, based } = finding;
  const governing = new Set(finding.governing ?? configs);
  const conditions = new Set(conditioned);
  const paths = new Set(mapped);
  const bases = new Set(based);
  const asks = (file: string): readonly string[] =>
    [conditions.has(file) ? 'customConditions' : '', paths.has(file) ? 'paths' : '', bases.has(file) ? 'baseUrl' : ''].filter(Boolean);
  const counted = (files: readonly string[]): string => {
    const [adding, mapping, basing] = [conditions, paths, bases].map((set) => files.filter((file) => set.has(file)).length);
    return `${adding} ${adding === 1 ? 'adds' : 'add'} conditions, ${mapping} ${mapping === 1 ? 'maps' : 'map'} paths, ` +
      `${basing} ${basing === 1 ? 'sets' : 'set'} baseUrl`;
  };
  lines.push(`  ${configs.length} tsconfig ${configs.length === 1 ? 'file' : 'files'} in the repository; ${counted(configs)}`);
  if (under !== '') lines.push(`  ${governing.size} of them can govern ${under}; ${counted([...governing])}`);
  // The configs that govern here first: they are what this directory loses.
  const asking = [...configs.filter((file) => governing.has(file)), ...configs.filter((file) => !governing.has(file))]
    .filter((file) => asks(file).length > 0);
  lines.push(
    ...asking.slice(0, LISTED).map((file) => `  ${file}: ${asks(file).join(', ')}`),
    ...(asking.length > LISTED ? [`  and ${asking.length - LISTED} more`] : []),
  );
  if (finding.declared === false) {
    if (asking.length > 0) lines.push('  no scan reads them for paths, baseUrl or conditions, so an import that reaches its target only through one is not resolved');
  } else if (asking.length === 0) {
    lines.push(
      '  reading them resolves no import differently; `"typescript": { "tsconfig": false }` in the root ' +
        'variance.config.json stops every scan reading one for paths, baseUrl or conditions',
    );
  } else if (asking.every((file) => !governing.has(file))) {
    lines.push(`  none that can govern ${under} asks; \`false\` reaches the whole repository, so it would stop the ${asking.length} that do as well`);
  }
  return lines;
}

/** The configs named one per line; a monorepo has thousands, and the count says the rest. */
const LISTED = 10;

function headline(declared: TsconfigUse['declared']): string {
  if (declared === undefined) return 'auto, the default';
  return declared === false ? 'off' : declared;
}
