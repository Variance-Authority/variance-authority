import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolator, type IsolatorProject } from './vite.js';

const STATE = 'const counts = new Map();\nexport const seen = (key) => counts.has(key);\n';

/** A project that calls the files `tests` names its tests, with the setup files given. */
const project = (tests: readonly string[], setupFiles: readonly string[] = []): IsolatorProject => ({
  config: { setupFiles },
  matchesTestGlob: (id) => tests.includes(id),
});

/** The plugin configured for `projects` under `root`, and what it warned. */
function configured(root: string, projects: readonly IsolatorProject[], exclude?: readonly string[]) {
  const plugin = isolator({ exclude });
  for (const each of projects) plugin.configureVitest({ project: each, vitest: { config: { root } } });
  const warnings: string[] = [];
  const transform = (code: string, id: string) => plugin.transform.call({ warn: (message) => warnings.push(message) }, code, id);
  return { transform, warnings };
}

describe('the isolator under Vitest', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'isolator-vite-')));

  it('rewrites a module of the run, and leaves what any project calls a test and every setup file', () => {
    const { transform } = configured(root, [project([join(root, 'a.test.ts')]), project([join(root, 'b.spec.ts')], [join(root, 'setup.ts')])]);
    expect(transform(STATE, join(root, 'state.ts'))?.code).toContain('@variance-authority/isolator/runtime');
    expect([transform(STATE, join(root, 'a.test.ts')), transform(STATE, join(root, 'b.spec.ts')), transform(STATE, join(root, 'setup.ts'))]).toEqual([undefined, undefined, undefined]);
  });

  it('leaves the globs it is handed, relative to the run root, and a module a query names by its path', () => {
    const { transform } = configured(root, [project([])], ['fixtures/**']);
    expect(transform(STATE, join(root, 'fixtures/state.ts'))).toBeUndefined();
    expect(transform(STATE, `${join(root, 'state.ts')}?v=1`)?.code).toContain('@variance-authority/isolator/runtime');
  });

  it('leaves what is not a script, and a virtual module', () => {
    const { transform } = configured(root, [project([])]);
    expect([transform('a { color: red }', join(root, 'a.css')), transform(STATE, '\0virtual:state.ts')]).toEqual([undefined, undefined]);
  });

  it('warns of a declaration it leaves shared, with the line and the reason', () => {
    const { transform, warnings } = configured(root, [project([])]);
    transform('export let count = 0;\nexport const bump = () => { count += 1; };\n', join(root, 'count.ts'));
    expect(warnings).toEqual([`isolator: count.ts:1 \`count\` stays shared: an exported \`let\` is read by its importers as a live binding, which no getter can stand in for`]);
  });

  it('refuses a module outside Vitest, before any project configured it', () => {
    const plugin = isolator();
    expect(() => plugin.transform.call({ warn: () => {} }, STATE, join(root, 'state.ts'))).toThrow('the plugin runs under Vitest');
  });
});
