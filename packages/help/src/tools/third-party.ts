/**
 * How a third-party hit is written: whose manifest offers it, how that manifest
 * declares it, at what version, and whether the code already imports it. What
 * the corpus could not resolve is said as such, never left blank, because a
 * blank reads as *nothing to know*.
 */

// compass: variance-authority.report.agent-surface

import type { LexiconScope, ThirdPartyMatch } from '../dependency-lexicon.js';

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
