/**
 * How the places that import a name are counted, the one count every answer
 * that says how many places import a name gives: the sites `uses` lists,
 * split by whether they import it for certain, and those split by whether
 * they are inside the package that declares the name or in another one.
 */

// compass: variance-authority.report.agent-surface

import type { Help } from '@variance-authority/package/help';
import { type Site, packageOf, publishedSitesOf, sureness } from './uses-of.js';

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

/** How many places import a name, and how many packages those places sit in. */
export interface Importing {
  readonly places: number;
  /** The packages the places sit in, the declaring one included; a place no manifest holds is in none. */
  readonly packages: number;
}

/** The places among `sites` that {@link counted} counts, and the packages they sit in. */
export function importing(sites: readonly Site[]): Importing {
  const { certain } = counted(sites, undefined);
  return { places: certain.length, packages: new Set(certain.flatMap((site) => packageOf(site.by) ?? [])).size };
}

/** What imports one published declaration, and why the imports within its package were not read, when they were not. */
export interface ImportingOne {
  readonly importing: Importing;
  readonly unread?: string;
}

/** The count for the published declaration of `name` in the file `at`. */
export type ImportingOf = (name: string, at: string) => ImportingOne;

/**
 * The count `uses` gives for a published declaration when asked for its name
 * and its file, read for each declaration the first time it is asked for: a
 * question reads it for the rows it shows, not for every name it holds.
 */
export function importingOf(help: Help, root: string | undefined): ImportingOf {
  const read = new Map<string, ImportingOne>();
  return (name, at) => {
    const key = `${at}\0${name}`;
    let one = read.get(key);
    if (one === undefined) {
      const { sites, unread } = publishedSitesOf(help, root, name, at);
      read.set(key, (one = { importing: importing(sites), ...(unread === undefined ? {} : { unread }) }));
    }
    return one;
  };
}
