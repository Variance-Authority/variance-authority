import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Read the prebuilt sensing agent installed into the inspected page. */
export async function bundlePresentationAgent(): Promise<string> {
  const candidates = [
    new URL('./browser-agent.bundle.js', import.meta.url),
    new URL('../dist/browser-agent.bundle.js', import.meta.url),
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      // Source tests and installed consumers reach different emitted locations.
    }
  }
  throw new Error(
    `the presentation sensing agent bundle is missing (looked in ` +
      `${candidates.map((path) => fileURLToPath(path)).join(' and ')}); ` +
      'it is built when the package is built: a checkout is missing its build, and an ' +
      'installed copy is missing a published file',
  );
}
