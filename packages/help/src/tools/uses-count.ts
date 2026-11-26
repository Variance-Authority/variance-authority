/**
 * How the places that import a name are counted, the one count every answer
 * that says how many places import a name gives: the sites `uses` lists,
 * split by whether they import it for certain, and those split by whether
 * they are inside the package that declares the name or in another one.
 */

// compass: variance-authority.report.agent-surface

import { type Site, packageOf, sureness } from './uses-of.js';

/** The places that import a name, those from other packages and those inside `home`. */
interface Counted {
  /** The sites that import the name, which are the places counted. */
  readonly certain: readonly Site[];
  /** The sites that may read the name and are no use of it, counted apart. */
  readonly off: readonly Site[];
  readonly whole: readonly Site[];
  /** The certain sites in other packages than `home`; none when no package is known to declare the name. */
  readonly outside: readonly Site[];
  /** The certain sites inside `home`; none when no package is known to declare the name. */
  readonly inside: readonly Site[];
}

/** Every site of a name counted against the package that declares it, when one is known. */
export function counted(sites: readonly Site[], home: string | undefined): Counted {
  const { certain, off, whole } = sureness(sites);
  return {
    certain,
    off,
    whole,
    ...apart(certain, home),
  };
}

/** `sites` split by whether they are inside `home`; none on either side when `home` is unknown. */
function apart(sites: readonly Site[], home: string | undefined): Pick<Counted, 'inside' | 'outside'> {
  return {
    outside: home === undefined ? [] : sites.filter((site) => site.by !== home),
    inside: home === undefined ? [] : sites.filter((site) => site.by === home),
  };
}

/** How many places import a name, and how many packages those places sit in. */
export interface ImportedIn {
  readonly places: number;
  /** The packages the places sit in, the declaring one included; a place no manifest holds is in none. */
  readonly packages: number;
}

/** The places among `sites` that {@link counted} counts, and the packages they sit in. */
export function importingIn(sites: readonly Site[]): ImportedIn {
  const { certain } = counted(sites, undefined);
  return { places: certain.length, packages: new Set(certain.flatMap((site) => packageOf(site.by) ?? [])).size };
}
