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
