import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, prose } from './markdown.js';
import { publishable } from './released.mjs';

/**
 * Every README a reader meets outside this repository points at `llms.txt`.
 *
 * An agent arrives on whichever README its search, its registry or its
 * `node_modules` handed it, and the answers it needs next — how to install, how
 * to link the shipped skills, which integration fits, an example to clone — are
 * spread over the site. `llms.txt` is the one index of all of them, so each of
 * these pages names it once, wherever the agent came in.
 *
 * The pages are every published package's, which npm renders — the release
 * owns which those are — and the ones published without a release: the root,
 * which GitHub renders, the editor clients', which their marketplaces render,
 * the JVM agent's, and the review console's, which is there to be copied out.
 */

const LLMS = 'https://variance-authority.dev/llms.txt';

const UNRELEASED = ['README.md', 'editors/vscode/README.md', 'editors/webstorm/README.md', 'jvm/README.md', 'tribunal-cloudflare/README.md'];

const READMES = [
  ...(publishable() as readonly { readonly directory: string }[])
    .map(({ directory }) => `${directory}/README.md`)
    .filter((file) => existsSync(join(ROOT, file))),
  ...UNRELEASED,
];

describe('a shipped README points at llms.txt', () => {
  it('reads every published package README', () => {
    expect(READMES).toContain('packages/cli/README.md');
    expect(READMES).toContain('packages/sense/npm/darwin-arm64/README.md');
  });

  it.each(READMES)('%s', (file) => {
    const links = prose(file).split(`(${LLMS})`).length - 1;
    expect(links, `${file} should link ${LLMS} once`).toBe(1);
  });
});
