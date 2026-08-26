import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundle each package's page half into its own `dist`, after `tsc` has emitted.
 *
 * A page agent is the one artifact in this repository that has to cross into a
 * browser, and it cannot cross as ESM: a module evaluates asynchronously, so the
 * "did the bundle install?" check races it instead of catching a broken one. It
 * therefore needs a bundler — and a bundler is not something a consumer of a
 * visual-regression tool should install, which `tools/shape.check.ts` enforces by
 * refusing build tools in any package's `dependencies`.
 *
 * So the bundling happens here, at this repository's build time, and the packages
 * ship the result. `cases/storybook-case` does the same thing for the same reason
 * in its own `collector/bundle.mjs`; the difference is only that a case is
 * allowed to own its bundler and a package is not.
 *
 * Generated rather than committed, so it cannot describe yesterday's collector
 * while every other signal says it is about today's.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each entry is `[package, entry within dist, output within dist]`. */
const AGENTS = [
  ['packages/presentation', 'browser-agent-entry.js', 'browser-agent.bundle.js'],
  ['packages/playwright-test', 'page-agent-entry.js', 'page-agent.bundle.js'],
  ['packages/storybook-collector', 'page-agent-entry.js', 'page-agent.bundle.js'],
  ['packages/route-collector', 'page-agent-entry.js', 'page-agent.bundle.js'],
];

for (const [pkg, entry, out] of AGENTS) {
  const from = join(ROOT, pkg, 'dist', entry);

  // A missing entry means `tsc` did not emit, which is a build ordering problem
  // and not something to paper over with an empty bundle: the failure would
  // arrive in a browser, as an agent that is simply not installed.
  if (!existsSync(from)) {
    throw new Error(`page-agents: ${pkg} has no built ${entry}; run \`tsc --build\` first`);
  }

  await build({
    entryPoints: [from],
    outfile: join(ROOT, pkg, 'dist', out),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  console.log(`page-agents: ${pkg}/dist/${out}`);
}
