// compass: variance-authority.reach.relations

/**
 * The package a file is in: the deepest of `packages` that holds it, so a
 * package nested in another owns its own files, or `.` when none does. A
 * package here is a listed one: a manifest no workspace pattern lists is part
 * of the listed package around it.
 */
export function packageOwner(packages: readonly string[]): (file: string) => string {
  const deepest = [...packages].sort((left, right) => right.length - left.length);
  return (file) => deepest.find((dir) => file.startsWith(`${dir}/`)) ?? '.';
}
