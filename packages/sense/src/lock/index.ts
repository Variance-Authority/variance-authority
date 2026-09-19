/**
 * What the installed dependencies are, read out of a lockfile.
 *
 * Text in, data out, and no file system: a caller supplies the two revisions it
 * wants compared — `git show <base>:yarn.lock` against the working copy, two CI
 * artifacts, two strings a test wrote — and this says which packages moved and
 * how they depend on each other. The git in that sentence belongs to the caller,
 * which is what lets the same three functions serve our own selector, another
 * tool's, and a script somebody writes this afternoon.
 *
 * ```ts
 * const before = readLockfile('yarn.lock', atBase);
 * const after = readLockfile('yarn.lock', atHead);
 * changedPackages(before, after); // ['jsdom', 'whatwg-url']
 * packageRelations(after);        // [['jest-environment-jsdom', 'jsdom'], …]
 * ```
 *
 * The lockfile is never read as a *changed path*. It is read as a source of
 * facts at two revisions, and that distinction is the whole reason this is worth
 * building: a lockfile in a diff says almost nothing — a workspace version bump
 * rewrites hundreds of lines and moves no installed byte — while the difference
 * between two reads of it says exactly what arrived.
 */

export { changedPackages, packageNameOf, packageRelations, type Lockfile } from './lockfile.js';
export { LOCKFILES, readLockfile } from './read.js';
export { Unreadable } from './yaml.js';
