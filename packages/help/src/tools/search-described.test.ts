import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { PACKAGES } from '../dependency-jobs.js';
import { workspaceOf } from '../dependency-jobs-fixture.js';
import { refreshDependencyLexicon } from '../dependency-lexicon.js';
import { answerSearch, searchIndexOf } from './search.js';

/**
 * A job is described in words, not in an identifier. A workspace that declares
 * only `react` reaches it from "state management" through the words of its
 * names; a job no declared dependency describes is answered empty with the scope
 * it looked at; and the words are read from the installed package when the
 * lexicon is refreshed, never when the question is asked.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

it('reaches react from "state management", answers an undescribed job empty with its scope, and reads the words at refresh', async () => {
  const root = await workspaceOf(PACKAGES, ['react']);
  const help = readHelp(root);
  const said = (query: string): string => answerSearch(searchIndexOf(help), { query }, treeOf([], root), root);

  const state = said('state management');
  expect(state).toContain('1 package describes `state management`');
  expect(state).toContain('react @1.0.0 · dependency in package.json · not imported');
  expect(state).toContain('[holds: state]');
  expect(state).not.toContain('redux');

  const none = said('resize images');
  expect(none).toContain('Third-party names searched: 1 package under package.json.');
  expect(none).not.toContain('describe');

  const manifest = join(root, 'node_modules/react/package.json');
  writeFileSync(manifest, JSON.stringify({ name: 'react', version: '1.0.0', description: 'Image resizing for components', types: 'index.d.ts' }));
  expect(said('resize images')).not.toContain('describes');
  refreshDependencyLexicon(root);
  expect(said('resize images')).toContain('1 package describes `resize images`');
});
