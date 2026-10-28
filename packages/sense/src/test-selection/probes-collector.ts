/**
 * The page collector, as a module a bundler can resolve.
 *
 * Never evaluated as written: every module the probes loader probes imports
 * this file through the loader alone, which answers with the collector's
 * source for the build's probe recipe. See [`probes-rule.ts`](./probes-rule.ts).
 */
export {};
