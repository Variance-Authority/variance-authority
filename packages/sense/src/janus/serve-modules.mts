// compass: variance-authority.reach
/**
 * The module loader's half of a `variance janus` run: Node's ESM loader reads
 * source through its own bindings, below `fs`, so `serve-fs.cts` cannot reach
 * an `import` of a served file. Preloaded through `NODE_OPTIONS=--import`, this
 * hook runs in the loading thread for `import` and `require` both.
 *
 * Resolution is Node's: a served file is one the checkout holds, so only its
 * content is the base's.
 */

import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import served from './served.cjs';

const { files, read } = served;

registerHooks({
  load(url, context, nextLoad) {
    const file = url.startsWith('file:') ? fileURLToPath(url) : undefined;
    const source = file === undefined ? undefined : files[file];
    if (file === undefined || source === undefined) return nextLoad(url, context);
    read(file);
    return { format: context.format ?? nextLoad(url, context).format, source, shortCircuit: true };
  },
});
