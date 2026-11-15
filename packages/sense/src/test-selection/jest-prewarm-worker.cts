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
  /** `@jest/transform`, resolved as Jest resolves it. */
  readonly transform: string;
  /** The project's configuration, as Jest's runner hands it to its workers. */
  readonly config: object;
  /** The coverage half of the options, as `jest-runner` hands `jest-runtime` them. */
  readonly coverage: object;
  readonly files: readonly string[];
}

let made: { readonly config: string; readonly transformer: Promise<ScriptTransformer> } | undefined;

/** Transform `files`, and say how many reached Jest's cache; a file whose transform throws is left to the test that loads it. */
async function warm(warming: Warming): Promise<number> {
  const config = JSON.stringify(warming.config);
  if (made?.config !== config) {
    const { createScriptTransformer } = require(warming.transform) as {
      createScriptTransformer: (config: object) => Promise<ScriptTransformer>;
    };
    made = { config, transformer: createScriptTransformer(warming.config) };
  }
  const transformer = await made.transformer;
  // As `jest-runtime`'s `defaultTransformOptions`, read in the process that will run the tests.
  const options = {
    isInternalModule: false,
    supportsDynamicImport: typeof (vm as { SyntheticModule?: unknown }).SyntheticModule === 'function',
    supportsExportNamespaceFrom: false,
    supportsStaticESM: false,
    supportsTopLevelAwait: false,
    ...warming.coverage,
  };
  let warmed = 0;
  for (const file of warming.files) {
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
