/**
 * One `jest-worker` child of the warm-up in [`jest-prewarm.ts`](./jest-prewarm.ts).
 *
 * It transforms each file it is handed the way a Jest test worker would on a
 * `require`: through `@jest/transform`'s `ScriptTransformer` for the project,
 * with the options `jest-runtime` hands it for a CommonJS module, so the entry
 * it leaves in Jest's cache is the one the test worker then looks for. The
 * transformer is the project's as configured, which under `withTestSelection`
 * is the wrapper that places the probes.
 */

import fs = require('node:fs');
import vm = require('node:vm');

interface ScriptTransformer {
  transform(filename: string, options: object, source: string): unknown;
}

/** What the main process hands each call. */
interface Warming {
  /** `@jest/transform`, resolved from the jest-runner that makes the test workers' transformer. */
  readonly transform: string;
  /** `jest-resolve`, resolved from the same jest-runner: its classifier says which files jest-runtime loads as ES modules. */
  readonly resolve: string;
  /** The project's configuration, as Jest's runner hands it to its workers. */
  readonly config: object;
  /** The coverage half of the options, as `jest-runner` hands `jest-runtime` them. */
  readonly coverage: object;
  readonly files: readonly string[];
}

/** Each project's transformer, by its configuration: a child is handed calls of several projects in any order. */
const made = new Map<string, Promise<ScriptTransformer>>();

/** Transform `files`, and say how many reached Jest's cache; a file whose transform throws is left to the test that loads it. */
async function warm(warming: Warming): Promise<number> {
  const config = JSON.stringify(warming.config);
  let making = made.get(config);
  if (making === undefined) {
    // The project's own @jest/transform, at the path its Jest resolved: no import names the adopter's copy.
    const { createScriptTransformer } = require(warming.transform) as {
      createScriptTransformer: (config: object) => Promise<ScriptTransformer>;
    };
    making = createScriptTransformer(warming.config);
    made.set(config, making);
  }
  const transformer = await making;
  // jest-runtime 30.5's `defaultTransformOptions`, the options it transforms a
  // CommonJS `require` with, read in the process that will run the tests. They
  // hold for CommonJS alone, which is why an ES module project is never warmed.
  const options = {
    isInternalModule: false,
    supportsDynamicImport: typeof (vm as { SyntheticModule?: unknown }).SyntheticModule === 'function',
    supportsExportNamespaceFrom: false,
    supportsStaticESM: false,
    supportsTopLevelAwait: false,
    ...warming.coverage,
  };
  // The project's own jest-resolve, at the path its jest-runner resolved: no import names the adopter's copy.
  const { default: Resolver } = require(warming.resolve) as {
    default: { unstable_shouldLoadAsEsm: (path: string, extensionsToTreatAsEsm: readonly string[]) => boolean };
  };
  const esm = (warming.config as { extensionsToTreatAsEsm?: readonly string[] }).extensionsToTreatAsEsm ?? [];
  let warmed = 0;
  for (const file of warming.files) {
    // A file jest-runtime loads as an ES module is transformed with other options under
    // the same cache key, so a CommonJS warm-up of it would hand the import CommonJS.
    if (Resolver.unstable_shouldLoadAsEsm(file, esm)) continue;
    try {
      transformer.transform(file, options, fs.readFileSync(file, 'utf8'));
      warmed += 1;
    } catch {
      // The test that loads it transforms it, and reports what this swallowed.
    }
  }
  return warmed;
}

export = { warm };
