/**
 * `@variance-authority/core/share` — one machine's evaluation, reachable from another.
 *
 * What a run derives about a commit — the suite, its subjects, their names,
 * which files declare which components — is expensive and identical on every
 * machine that starts from the same tree, so a pull-request runner reads what
 * mainline already published. A `LineCell` holds the latest of one mainline or
 * branch, and a mainline's at each commit it published; `publishLine` writes it and
 * `readLine` reads it back, with the reason when it cannot.
 *
 * Not a baseline store: a line holds only what its commit can derive again, so
 * a miss costs the derivation, where a baseline cannot be derived again and
 * [`RasterStore`](https://github.com/Variance-Authority/variance-authority/blob/main/packages/raster/src/store.ts)
 * throws on every failure.
 */

export * from './line.js';
export * from './publish.js';
export * from './at-commit.js';
export * from './http-line.js';
