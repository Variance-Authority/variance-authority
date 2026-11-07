// compass: variance-authority.reach.relations

/**
 * The package a file is in: the deepest of `packages` that holds it, so a
 * package nested in another owns its own files, or `.` when none does. A
 * package here is a listed one: a manifest no workspace pattern lists is part
 * of the listed package around it.
 */
export function packageOwner(packages: readonly string[]): (file: string) => string {
  const listed = new Set(packages);
  return (file) => {
    for (let slash = file.lastIndexOf('/'); slash > 0; slash = file.lastIndexOf('/', slash - 1)) {
      const dir = file.slice(0, slash);
      if (listed.has(dir)) return dir;
    }
    return '.';
  };
}
