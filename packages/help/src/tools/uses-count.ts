/**
 * How the places that import a name are counted, the one count every answer
 * that says how many places import a name gives: the sites `uses` lists,
 * split by whether they import it for certain, and those split by whether
 * they are inside the package that declares the name or in another one.
 */

// compass: variance-authority.report.agent-surface

import { type Site, sureness } from './uses-of.js';

/** The places that import a name, those from other packages and those inside `home`. */
export interface Counted {
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
export function apart(sites: readonly Site[], home: string | undefined): Pick<Counted, 'inside' | 'outside'> {
  return {
    outside: home === undefined ? [] : sites.filter((site) => site.by !== home),
    inside: home === undefined ? [] : sites.filter((site) => site.by === home),
  };
}

/**
 * Where the places are, said after the count: `: 1 from another package and
 * 2 inside @acme/lib` when they are on both sides, `, all inside @acme/lib`
 * or `, from another package` when they are on one; empty when there is no
 * place.
 */
export function spokenSplit(count: Pick<Counted, 'inside' | 'outside'>, home: string): string {
  const outside = count.outside.length;
  const inside = count.inside.length;
  if (outside > 0 && inside > 0) {
    return `: ${outside} from ${outside === 1 ? 'another package' : 'other packages'} and ${inside} inside ${home}`;
  }
  if (outside > 0) return outside === 1 ? ', from another package' : ', all from other packages';
  if (inside > 0) return inside === 1 ? `, inside ${home}` : `, all inside ${home}`;
  return '';
}
