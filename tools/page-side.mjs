import { relative, resolve } from 'node:path';

/**
 * The modules a probe may not be placed in, and what each one would break.
 *
 * A probe is a call to a declaration the instrumenter writes at the top of the
 * module it probes. That declaration is module scope, and module scope is the
 * one thing a function loses when its *source text* crosses into another realm:
 * `page.evaluate(fn)` sends `fn.toString()` to a browser where nothing named
 * `__va` exists, and the first probe throws `ReferenceError` inside a headless
 * page nobody is watching.
 *
 * The product refuses to soften that. Guarding each call site with a `typeof`
 * was tried and rejected: the page continues, its evidence is silently
 * discarded, and a runner misconfiguration hides behind a green suite
 * ([journal 0027](../docs/context/journal/0027-what-instrumentation-costs.md)).
 *
 * A module that hands its own function to a page is not on this list. The
 * instrumenter reads the call — `evaluate`, `addInitScript`, `waitForFunction`,
 * `$eval` and the rest — finds the function it sends, written at the call or
 * declared in the same module, and places no probe inside it; the rest of the
 * module is probed as any other. What it cannot read from a module's own text
 * is a function written somewhere else and sent from here, and that module is
 * the one named below.
 *
 * ## How this list stays honest
 *
 * Completeness is not statically decidable, and it does not need to be,
 * because the suite itself is the check. Miss one and `yarn test` fails loudly
 * at the first probe, which is exactly the failure the product chose to keep.
 *
 * `tools/page-side.check.ts` holds the other end, which is the direction nothing
 * else watches: an entry that has stopped being true costs a module its
 * measurement, silently and for as long as nobody looks. A module in
 * {@link SERIALIZED} is only marked as loaded, so a change to it selects every
 * test that loaded it; one in {@link RUNTIME} is neither probed nor marked, so
 * a change to it is answered by the import graph. So every entry must name a
 * module that is there, once.
 *
 * Written as extensionless repository-relative stems, because the same module
 * arrives at the runner twice — once as the `src` its own package's tests
 * import, once as the `dist` every other package resolves through.
 */
/**
 * Written to be serialized: the page half of an adapter, alone in its module
 * because it may close over nothing and import nothing but types.
 *
 * Named rather than derived, because the crossing happens somewhere else. There
 * is no call here to find — that is the whole shape of the pattern — so the only
 * thing that can put a module in this group is somebody deciding it belongs.
 */
export const SERIALIZED = [
  'packages/sense/src/test-selection/case-preconditions',
  'packages/storybook/src/preview-globals',
  'packages/storybook/src/show-story',
  'packages/storybook/src/story-finished',
  'packages/storybook/src/story-parameters',
  'packages/storybook/src/story-test-environment',
  'packages/storybook/src/story-timing-read',
];

/**
 * The probe runtime, which cannot be its own subject.
 *
 * `__VA__` is one global: instrumenting the collector means a probe inside the
 * collector calls the collector, and a test that installs a fake in its place is
 * answered by recursion or by a `TypeError` at the first probe.
 *
 * So the runtime is the modules that read or install `__VA__`, named one by
 * one, and not the directory they sit in — less the `.cts` collectors, which
 * are loaded with `require` and never pass through the transform: the rest of `test-selection` — the
 * recording's readers, the selection, the counts — is code the suite asserts
 * on, and leaving it out made it before reach, run under every test and
 * measured by none.
 */
export const RUNTIME = [
  'packages/sense/src/instrument/',
  'packages/sense/src/test-selection/journey',
  'packages/sense/src/test-selection/journey-parts',
  'packages/sense/src/test-selection/probes',
  'packages/sense/src/test-selection/runner',
  'packages/sense/src/test-selection/vitest',
];

export const PAGE_SIDE = [...SERIALIZED, ...RUNTIME];

/**
 * A transformed module named the way this list names it.
 *
 * `dist` folds onto `src` because they are one edit: a package's own tests
 * import `../src/thing.ts` and every other package's tests resolve
 * `dist/thing.js` through the manifest's `exports`. The extension goes with it,
 * since `.ts`, `.tsx` and the `.js` they compile to are the same module.
 *
 * A leading run of `..` folds away for the same reason. Yarn links every
 * workspace into `node_modules`, and in a git worktree those links point at the
 * checkout the repository was cloned into — so the same `dist` module arrives as
 * `packages/core/dist/index.js` from one importer and
 * `../../../packages/core/dist/index.js` from the next, depending on which one
 * resolved it first. Both are this
 * repository's file. Reading the second as somebody else's would hand a probe to
 * a module the list has already ruled out, and the failure would be a
 * `ReferenceError` in a headless page rather than anything that names this line.
 *
 * `file` may be absolute or relative to `root`; it is resolved either way, so a
 * caller holding a path out of a coverage snapshot asks the same question the
 * instrumenter asks with an absolute one.
 */
export function sourceStem(root, file) {
  return relative(root, resolve(root, file))
    .replace(/\\/g, '/')
    .replace(/^(\.\.\/)+/, '')
    .replace(/^(packages\/[^/]+)\/dist\//, '$1/src/')
    .replace(/\.[cm]?[jt]sx?$/, '');
}

/** Whether one entry claims one stem: a file by name, or a directory by prefix. */
export function claims(entry, stem) {
  return entry.endsWith('/') ? stem.startsWith(entry) : stem === entry;
}

/** Whether a transformed module may carry probes. */
export function probeable(root, file) {
  const stem = sourceStem(root, file);
  return !PAGE_SIDE.some((entry) => claims(entry, stem));
}

/**
 * Whether a transformed module is marked as loaded where it may not be probed.
 *
 * A module written to be serialized is still loaded in this process, by the
 * tests that hand its functions to a page, and a mark at the end of its text
 * says which tests did without placing anything inside a function. An edit to
 * it then selects those tests whole. The probe runtime is not marked: the mark
 * calls the runtime, which cannot be its own subject.
 */
export function marked(root, file) {
  const stem = sourceStem(root, file);
  return SERIALIZED.some((entry) => claims(entry, stem));
}
