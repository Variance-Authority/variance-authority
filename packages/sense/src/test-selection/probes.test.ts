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
import { writeFile } from 'node:fs/promises';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
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
