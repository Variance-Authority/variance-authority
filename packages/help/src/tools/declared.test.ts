import { describe, expect, it } from 'vitest';
import { spellingOf } from '@variance-authority/mcp/tools';
import { reachSentences } from './declared.js';

/**
 * A Python name a leading underscore keeps out of `import *` is still
 * importable by name, and the answer names the question that finds who does:
 * `grep` for the name as a word, from the file that declares it. The shell's
 * spelling is pinned where `variance ask` answers it; this pins the wire's, so
 * an MCP client reads the tool and inputs its schema publishes.
 */

const held = { at: 'packages/kit/kit/restart.py', name: '_relaunch', reach: 'underscore' } as const;

describe('the question an underscored name sends its reader to', () => {
  it('is spelled in the wire’s names over MCP', () => {
    expect(reachSentences(held, spellingOf(undefined)).clause).toBe(
      '; another module can still import it by name, which `docs_grep` with `query` `\\b_relaunch\\b` and `to` `packages/kit/kit/restart.py` finds',
    );
  });

  it('is spelled as a shell types it from one', () => {
    expect(reachSentences(held, spellingOf({ shell: 'variance-authority-help' })).clause).toBe(
      "; another module can still import it by name, which `variance-authority-help grep --query '\\b_relaunch\\b' --to packages/kit/kit/restart.py` finds",
    );
  });
});
