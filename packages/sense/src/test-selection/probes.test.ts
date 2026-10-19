/**
 * Where the collector import goes in a module the build probes.
 *
 * A directive is only a directive in the prologue: React Server Components
 * read `"use client"` and `"use server"` there, and a module whose first
 * statement is anything else is a server module. A probed client component
 * that stopped being one would render on the server and never reach the page
 * that was to be recorded.
 */
import { resolve } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { instrumentationId, probeRecipe } from '../instrument/index.js';
import { testSelectionProbes } from './probes.js';
import { inRoot } from './__fixtures__/browser-page.js';

const CLIENT = '"use client";\nimport { useState } from "react";\nexport function Since() { return useState(0)[0]; }\n';

function statements(code: string): readonly { type: string; directive?: string; source?: { value: string } }[] {
  return parseSync('module.js', code, { sourceType: 'module' }).program.body as never;
}

describe('the collector import', () => {
  it('leaves a directive prologue first, so a client component stays one', async () => {
    await inRoot(async (root) => {
      const module = resolve(root, 'Since.js');
      await writeFile(module, CLIENT, 'utf8');

      const { code } = testSelectionProbes({ root }).transform.handler(CLIENT, module)!;
      const body = statements(code);

      expect(body[0]).toMatchObject({ type: 'ExpressionStatement', directive: 'use client' });
      expect(body.some((statement) => statement.type === 'ImportDeclaration' && statement.source?.value === 'variance-authority:execution-collector')).toBe(true);
      // Every line of the module stays where the file had it.
      expect(code.split('\n')[0]).toMatch(/^"use client";/);
      expect(code.split('\n')[1]).toMatch(/^import \{ useState \} from "react";/);
    });
  });
});

describe('a build under the loads recipe', () => {
  it('names its own recipe, and carries the digest of the presence recipe, which covers the header and the walk', () => {
    const presence = probeRecipe('presence');
    expect(probeRecipe('loads')).toBe(`${instrumentationId('loads')}${presence.slice(presence.indexOf('+'))}`);
  });

  it('marks each module as loaded after its own text, and probes nothing inside it', async () => {
    await inRoot(async (root) => {
      const module = resolve(root, 'Since.js');
      await writeFile(module, CLIENT, 'utf8');

      const { code } = testSelectionProbes({ root, mode: 'loads' }).transform.handler(CLIENT, module)!;

      expect(code.startsWith(`${CLIENT}\n;`)).toBe(true);
      expect(code).toContain('.m("Since.js@~');
      expect(code).not.toMatch(/__va\(\d+\)/);
      expect(statements(code).some((statement) => statement.type === 'ImportDeclaration' && statement.source?.value === 'variance-authority:execution-collector')).toBe(true);
    });
  });
});

describe('a module the dev server loads, whose file is there and cannot be read', () => {
  it('fails, naming the file and why, rather than probing it as a module no file holds', async () => {
    await inRoot(async (root) => {
      const module = resolve(root, 'Since.js');
      await writeFile(module, CLIENT, 'utf8');
      const plugin = testSelectionProbes({ root });
      plugin.configResolved({ command: 'serve', plugins: [] } as never);
      // A directory where the file was: unreadable to every user, root included.
      await rm(module);
      await mkdir(module);
      expect(() => plugin.load(module)).toThrow(/Since\.js.*EISDIR/s);
    });
  });
});

describe('a plugin that runs its `transform` after the probes', () => {
  const handler = (code: string) => code;

  it('stops the run, naming the plugin and both ways out', () => {
    const plugin = testSelectionProbes();
    const plugins = [plugin, { name: 'their-post', transform: { order: 'post', handler } }];
    expect(() => plugin.configResolved({ command: 'build', plugins } as never)).toThrow(
      /`their-post` runs its `transform` after `variance-authority:test-selection-probes`.*move it ahead of the probes, or set `placement: 'before-transforms'`/s,
    );
  });

  it('is no matter under `before-transforms`, where the probes go in ahead of every transform', () => {
    const plugin = testSelectionProbes({ placement: 'before-transforms' });
    const plugins = [plugin, { name: 'their-post', transform: { order: 'post', handler } }];
    expect(() => plugin.configResolved({ command: 'build', plugins } as never)).not.toThrow();
  });
});
