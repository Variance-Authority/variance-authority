import { describe, expect, it } from 'vitest';
import { HELP_TOOLS } from '@variance-authority/help/tools';
import { COSTS_TOOLS, REVIEW_TOOLS, TOOLS, VANTAGE_TOOLS, toolByName, verbOf } from '@variance-authority/mcp/tools';
import { questions } from './ask-questions.js';
import { takes } from './asking.js';

const ASKED = [...TOOLS, ...VANTAGE_TOOLS, ...HELP_TOOLS, ...COSTS_TOOLS, ...REVIEW_TOOLS];

/**
 * Bare `variance ask` is the list an agent picks a question from, and the
 * install check: a question's whole description is what an MCP client reads at
 * `tools/list`, so the list carries only enough of it to choose by.
 */
describe('the list of questions', () => {
  it('prints at most two lines per question: what it takes, then the first sentence of what it answers', () => {
    const lines = questions().split('\n');
    const entries = lines.filter((line) => line !== '' && !/^[A-Z ]+$/.test(line));
    const signatures = new Set(ASKED.map((tool) => `${verbOf(tool)}${takes(tool)}`));
    const prose = entries.filter((line) => line.startsWith('    '));

    expect(entries.filter((line) => signatures.has(line))).toHaveLength(ASKED.length);
    expect(prose.length).toBeLessThanOrEqual(ASKED.length);
    for (const [at, line] of lines.entries()) {
      if (signatures.has(line)) expect(lines[at + 2]?.startsWith('    ')).toBe(false);
    }
    const summary = lines.indexOf('summary');
    expect(lines[summary + 1]).toBe(
      '    What the last visual run found: counts by verdict, then one line per subject that needs attention, then which subjects were not observed at all.',
    );
    expect(signatures).toContain(lines[summary + 2]);
  });

  it('ends a first sentence where the next opens with a tool name, quoted as code', () => {
    const lines = questions().split('\n');
    const claims = lines.findIndex((line) => line.startsWith('test-claims'));
    expect(lines[claims + 1]).toMatch(/its pieces and wholes\.$/);
  });

  it('leaves the rest of each description to the MCP tool it mirrors, and says so', () => {
    expect(toolByName('variance_summary')!.description).toContain('Start here.');
    expect(questions()).not.toContain('Start here.');
    expect(questions()).toContain('`tools/list`');
  });
});
