/**
 * Where a page hands its journal over.
 *
 * Deliberately not a short name: this shares a global namespace with whatever
 * application the page already loaded, and a collision would be discovered as a
 * confusing selection rather than as an error.
 *
 * Alone in its module, because both ends read it and only one of them may
 * load a build: the plugin that installs the collector, and a page.
 */
export const EXECUTION_GLOBAL = '__variance_authority_execution__';

/**
 * Where a driver says a page is its own: set by whatever drains the page from
 * outside, before the page runs or as it first drains.
 *
 * Apart from the cookies a driver leaves for a server head, since a run that
 * names no head leaves none and still needs everything the collector holds.
 */
export const DRIVEN_GLOBAL = '__variance_authority_driven__';
