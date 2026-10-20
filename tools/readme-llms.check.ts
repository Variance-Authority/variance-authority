import { describe, expect, it } from 'vitest';
import { MARKDOWN, prose } from './markdown.js';

/**
 * Every README a reader meets outside this repository points at `llms.txt`.
 *
 * An agent arrives on whichever README its search, its registry or its
 * `node_modules` handed it, and the answers it needs next — how to install, how
 * to link the shipped skills, which integration fits, an example to clone — are
 * spread over the site. `llms.txt` is the one index of all of them, so each of
 * these pages names it once, wherever the agent came in.
 *
 * The pages are the root, every package's (npm renders it), the editor clients'
 * (their marketplaces render it), the JVM agent's and the review console's,
 * which is there to be copied out. A fixture's README is test input, and the
 * case and example workspaces, `docs/` and `.compass/` are read inside the
 * repository, where the site and `AGENTS.md` already lead.
 */

const LLMS = 'https://variance-authority.dev/llms.txt';

const SHIPPED = /^(?:README\.md|packages\/[^/]+\/README\.md|packages\/[^/]+\/npm\/[^/]+\/README\.md|editors\/[^/]+\/README\.md|jvm\/README\.md|tribunal-cloudflare\/README\.md)$/;

const READMES = MARKDOWN.filter((file) => SHIPPED.test(file));

describe('a shipped README points at llms.txt', () => {
  it('reads every package README', () => {
    expect(READMES).toContain('packages/cli/README.md');
    expect(READMES).toContain('packages/sense/npm/darwin-arm64/README.md');
    expect(READMES).not.toContain('packages/help/src/__fixtures__/workspace/packages/alpha/README.md');
  });

  it.each(READMES)('%s', (file) => {
    expect(prose(file).includes(`(${LLMS})`), `${file} should link ${LLMS}`).toBe(true);
  });
});
