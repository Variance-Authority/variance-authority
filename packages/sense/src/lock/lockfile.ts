/**
 * What a lockfile is read down to, and the two questions asked of it.
 *
 * Everything below the readers collapses to package **names**. A lockfile is a
 * graph of resolutions — `lodash@npm:^4.17.20` and `lodash@npm:^4.17.21` are two
 * of them, and pnpm writes a fourth for every peer combination — but source code
 * asks for a name. A file that writes `import … from 'lodash'` is reached by any
 * lodash moving, and no scan can tell which instance the resolver handed it
 * without reproducing that resolver.
 *
 * So the collapse is not a simplification, it is the correct grain, and it is the
 * conservative one in both directions: if any instance of a name moved, the name
 * moved; if any instance of a name depends on `bar`, the name depends on `bar`.
 * Both over-include, and over-including is a run that observes more than it had
 * to ([`docs/selecting.md`](../../../../docs/selecting.md)).
 *
 * Workspaces are left out of every reader, and that is what makes this usable at
 * all. A workspace package is *our* source: the file graph already holds it, edge
 * for edge, and admitting it here a second time as an opaque name would turn one
 * edited file in a monorepo into every package that depends on it.
 */

/** A lockfile read down to names. */
export interface Lockfile {
  /** Which reader answered — printed when a run widens, never matched on. */
  readonly format: string;

  /**
   * Package name to the text that identifies what is installed under it.
   *
   * Compared, never parsed. Whatever the format offered that moves when the
   * bytes on disk move — a version, a resolution, an integrity hash — joined in
   * a stable order across every instance of the name.
   */
  readonly identities: ReadonlyMap<string, string>;

  /** Package name to the names it depends on, itself excluded. */
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
}

/**
 * The package a descriptor names.
 *
 * The first `@` after position zero, which is the one rule every format agrees
 * on: `lodash@npm:^4.17.21`, `@babel/core@7.24.7`, `foo@npm:@scope/bar@1.0.0`.
 * The last `@` would be wrong for the alias in that third one, whose importers
 * write `foo` and nothing else.
 */
export function packageNameOf(descriptor: string): string {
  const at = descriptor.indexOf('@', 1);
  const name = at === -1 ? descriptor : descriptor.slice(0, at);
  return name;
}

/** Strip a peer-dependency or archive suffix: `foo@1.0.0(bar@2.0.0)`. */
export function withoutPeers(key: string): string {
  const open = key.indexOf('(');
  return open === -1 ? key : key.slice(0, open);
}

/**
 * The accumulator every reader fills.
 *
 * Shared so that the collapse to names — deduplication, self-edge removal, the
 * stable join of identities — is written once and cannot drift between four
 * formats that would otherwise each invent it.
 */
export class Packages {
  private readonly identities = new Map<string, Set<string>>();
  private readonly dependencies = new Map<string, Set<string>>();

  /** Record one instance of `name`, identified by `identity`. */
  add(name: string, identity: string): void {
    if (name === '') return;
    let known = this.identities.get(name);
    if (known === undefined) {
      known = new Set();
      this.identities.set(name, known);
    }
    known.add(identity);
  }

  /** Record that some instance of `name` depends on `on`. */
  depend(name: string, on: string): void {
    if (name === '' || on === '' || name === on) return;
    let known = this.dependencies.get(name);
    if (known === undefined) {
      known = new Set();
      this.dependencies.set(name, known);
    }
    known.add(on);
  }

  done(format: string): Lockfile {
    const identities = new Map<string, string>();
    for (const [name, instances] of this.identities) {
      identities.set(name, [...instances].sort(byCodeUnit).join(' '));
    }

    const dependencies = new Map<string, readonly string[]>();
    for (const [name, on] of this.dependencies) {
      // A dependency on something the lockfile never resolved is dropped rather
      // than kept as a name with no identity: it can never change, so an edge to
      // it could never carry anything, and it would show up in the graph as a
      // package nothing installed.
      const edges = [...on].filter((to) => this.identities.has(to)).sort(byCodeUnit);
      if (edges.length > 0) dependencies.set(name, edges);
    }

    return { format, identities, dependencies };
  }
}

/**
 * Which packages moved between two reads of the lockfile.
 *
 * Added, removed, and re-resolved alike. A removal counts because a file
 * importing a package that is no longer installed is a file whose behaviour
 * changed, and the most visible way it can change.
 *
 * Two different formats mean the project switched package managers, and nothing
 * survives that comparison: every name in either read is returned. That is the
 * honest answer and it costs one wide run on the commit that did it.
 */
export function changedPackages(before: Lockfile, after: Lockfile): readonly string[] {
  const changed: string[] = [];
  const names = new Set([...before.identities.keys(), ...after.identities.keys()]);
  const mixed = before.format !== after.format;

  for (const name of names) {
    if (mixed || before.identities.get(name) !== after.identities.get(name)) changed.push(name);
  }

  return changed.sort(byCodeUnit);
}

/**
 * The `package → package` edges, in the direction the rest of the graph reads:
 * a pair is `[dependent, dependency]`, matching `A → B` meaning *A rests on B*.
 *
 * This is the half that carries a transitive bump up to source. Nothing in our
 * code imports `jsdom`, so a `jsdom` bump seeds a node no file touches — until
 * these edges walk it to `jest-environment-jsdom`, which a config does import.
 */
export function packageRelations(lock: Lockfile): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];

  for (const [name, on] of [...lock.dependencies].sort(([a], [b]) => byCodeUnit(a, b))) {
    for (const to of on) pairs.push([name, to]);
  }

  return pairs;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
