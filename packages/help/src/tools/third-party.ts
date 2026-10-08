/**
 * How a third-party hit is written: whose manifest offers it, how that manifest
 * declares it, at what version, and whether the code already imports it. What
 * the corpus could not resolve is said as such, never left blank, because a
 * blank reads as *nothing to know*.
 */

// compass: variance-authority.report.agent-surface

import type { DependencySkill, DescribedPackage, LexiconScope, ThirdPartyMatch } from '../dependency-lexicon.js';

/** Why a third-party name is offered: whose manifest, declared how, at what version, and whether the code already imports it. */
export function provenance(match: ThirdPartyMatch): string {
  const declared = match.declaredAs === undefined ? `imported under ${match.manifest}, not declared there` : `${match.declaredAs} in ${match.manifest}`;
  const version = match.version === undefined ? 'version not resolved' : `@${match.version}`;
  const used =
    match.imports === undefined
      ? 'imports not indexed'
      : match.imports === 0
        ? 'not imported'
        : `imported ${match.imports}× (first ${match.site ?? 'site not recorded'})`;
  return `${version} · ${declared} · ${used}`;
}

/** One hit of a search, on a line. */
export const thirdLine = (match: ThirdPartyMatch): string =>
  `${match.specifier} · ${match.name} [${match.kind}] ${provenance(match)} — ${match.summary ?? 'UNDOCUMENTED'}`;

/** What an empty third-party answer looked at, so it is not read as *nothing is usable here*. */
export function thirdScope(scope: LexiconScope): string {
  if (scope.packages === 0) return 'No dependency was searched: no manifest in reach declares or imports one.';
  const at = scope.owners.length <= 3 ? scope.owners.join(', ') : `${scope.owners.slice(0, 3).join(', ')} and ${scope.owners.length - 3} more`;
  return `Third-party names searched: ${scope.packages} ${scope.packages === 1 ? 'package' : 'packages'} under ${at}.`;
}

/** One package that describes the job, on a line: what it says it is, and why it is offered. */
export function describedLine(hit: DescribedPackage): string {
  const version = hit.version === undefined ? 'version not resolved' : `@${hit.version}`;
  const declared = hit.declaredAs === undefined ? `imported under ${hit.manifest}, not declared there` : `${hit.declaredAs} in ${hit.manifest}`;
  const used = hit.imports === undefined ? 'imports not indexed' : hit.imports === 0 ? 'not imported' : `imported ${hit.imports}× (first ${hit.site ?? 'site not recorded'})`;
  const says = hit.description === undefined ? 'no description published' : hit.description.length > 140 ? `${hit.description.slice(0, 137)}...` : hit.description;
  return `${hit.specifier} ${version} · ${declared} · ${used} — ${says} [holds: ${hit.words.join(', ')}]`;
}

/** One skill a package ships, indented under the package: the file to read, and when its front matter says to read it. */
export function shippedSkillLine(skill: DependencySkill): string {
  const says =
    skill.unreadable !== undefined ? `unreadable: ${skill.unreadable}`
    : skill.description === undefined ? 'no description in its front matter'
    : skill.description.length > 200 ? `${skill.description.slice(0, 197)}...`
    : skill.description;
  return `    skill ${skill.name}: ${skill.at} — ${says}`;
}

/** Each described hit, then the skills its package ships, each `SKILL.md` named once: a package's entry points share them. */
export function describedWithSkills(described: readonly DescribedPackage[]): string[] {
  const named = new Set<string>();
  return described.flatMap((hit) => [
    describedLine(hit),
    ...(hit.skills ?? []).filter((skill) => !named.has(skill.at) && named.add(skill.at)).map(shippedSkillLine),
  ]);
}
