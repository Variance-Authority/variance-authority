/** The exact path membership a module landing needs from the scanned tree. */
export interface TreeWorld {
  has(path: string): boolean;
}

/** A membership view over the repository paths the scan already established. */
export function worldIn(paths: Iterable<string>): TreeWorld {
  const held = new Set(paths);
  return { has: (path) => held.has(path) };
}
