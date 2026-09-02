import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Read the browser agent produced by this repository's build. */
export async function bundleEyesAgent(): Promise<string> {
  const candidates = [
    new URL('./page-agent.bundle.js', import.meta.url),
    new URL('../dist/page-agent.bundle.js', import.meta.url),
  ];

  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      // Source tests use the first path; installed consumers use the second.
    }
  }

  throw new Error(
    `the eyes page agent bundle is missing (looked in ` +
      `${candidates.map((path) => fileURLToPath(path)).join(' and ')}); ` +
      'it is produced by this repository’s build, not at test time',
  );
}
