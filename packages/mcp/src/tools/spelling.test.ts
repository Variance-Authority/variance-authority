/// <depends path="../../../sense/native/src/spelling-cases.json" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { spellingOf } from './spelling.js';
import type { Tool } from './tool.js';

interface Case {
  readonly verb: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly shell: string;
  readonly wire: string;
}

const CASES = JSON.parse(readFileSync(new URL('../../../sense/native/src/spelling-cases.json', import.meta.url), 'utf8')) as readonly Case[];

describe('a question', () => {
  it.each(CASES)('is spelled as the wire and the shell take it: $shell', ({ verb, input, shell, wire }) => {
    const tool: Pick<Tool<never>, 'name' | 'description' | 'inputSchema'> = { name: `docs_${verb}`, description: '', inputSchema: { type: 'object', properties: {} } };
    expect(spellingOf({ shell: 'variance ask' }).question(tool, input)).toBe(shell);
    expect(spellingOf(undefined).question(tool, input)).toBe(wire);
  });
});
