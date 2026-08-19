import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The page half, read from this package's own build output.
 *
 * Built rather than bundled here, and that is the shape rule rather than a
 * preference: a bundler in this package's `dependencies` would be a bundler in
 * an adopter's install, which `tools/shape.check.ts` refuses. `tools/page-agents.mjs`
 * produces the file during this repository's build, from the same source the Node
 * half imports its types from.
 *
 * IIFE rather than ESM, and installed with `addInitScript` rather than
 * `addScriptTag`. A module evaluates asynchronously, so the "did the bundle
 * install?" check races it instead of catching a broken one — and an init script
 * survives the navigations a real test performs, which a tag appended after one
 * load does not.
 */
export async function bundlePageAgent(): Promise<string> {
  const candidates = [
    new URL('./page-agent.bundle.js', import.meta.url),
    new URL('../dist/page-agent.bundle.js', import.meta.url),
  ];

  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      // The source path is used by tests; the dist path is used by consumers.
    }
  }

  // Named rather than swallowed. Without this the failure arrives in a browser
  // as an agent that is merely absent, which reads like a page problem.
  throw new Error(
    `the variance page agent bundle is missing (looked in ` +
      `${candidates.map((path) => fileURLToPath(path)).join(' and ')}); ` +
      'it is produced by this repository’s build, not at test time',
  );
}
