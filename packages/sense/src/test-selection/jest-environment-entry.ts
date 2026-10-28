/** A cached entry that loads the project's environment inside Jest's transpilation window. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { markModule } from './captured-modules.js';
import { insideRoot } from './instrumented-modules.js';
import type { ModuleId } from '../instrument/index.js';
import { digestString } from '../digest.js';
import { cacheRootFor } from './cache-root.js';

/** The environment entry Jest imports, before it removes its transpilation hook. */
export function environmentEntry(root: string, environment: string, bridge: string): string {
  const source = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { markEnvironmentInput } = await import(${JSON.stringify(import.meta.url)});
const bridge = require(${JSON.stringify(bridge)});
bridge.preload(${JSON.stringify(resolve(cacheRootFor(root), 'jest-environments'))});
const Base = await bridge.load(${JSON.stringify(environment)});
export default bridge.wrap(Base, ${JSON.stringify(environment)}, ${JSON.stringify(root)}, (file) => markEnvironmentInput(${JSON.stringify(root)}, file));
`;
  const file = resolve(cacheRootFor(root), 'jest-environments', `${encodeURIComponent(digestString(source))}.mjs`);
  // Entries are content-addressed and identical across concurrent configurations.
  // Do not rewrite a warm entry while another worker is importing it.
  try {
    if (readFileSync(file, 'utf8') === source) return file;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  mkdirSync(dirname(file), { recursive: true });
  const pending = `${file}.${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(pending, source, 'utf8');
  renameSync(pending, file);
  return file;
}

/** An opaque input outside the install, read by the same source/map owner as transformed modules. */
export function markEnvironmentInput(root: string, file: string): ModuleId | undefined {
  const accepts = (path: string): boolean => insideRoot(root, path) && !/[\\/]node_modules[\\/]/u.test(path) && !path.endsWith('.node');
  if (!accepts(file)) return undefined;
  return markModule(root, file, readFileSync(file, 'utf8'), accepts)?.module.id;
}
