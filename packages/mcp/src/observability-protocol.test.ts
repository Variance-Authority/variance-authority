import { describe, expect, it } from 'vitest';
import {
  EYES,
  OBSERVABILITY,
  PRESENTATIONS,
  SCENARIOS,
  handle,
} from './protocol.js';
import { OBSERVABILITY_TOOLS } from './tools.js';

describe('the all-instrument MCP surface', () => {
  it('announces every native vocabulary once behind one connection', () => {
    expect(EYES.tools.map(({ name }) => name)).toContain('variance_test_attention');
    expect(PRESENTATIONS.tools.map(({ name }) => name)).toContain('variance_presentations');
    expect(SCENARIOS.tools.map(({ name }) => name)).toContain('variance_scenarios');
    const response = handle(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      () => ({}),
      OBSERVABILITY,
    );
    const names = (response!.result as { tools: { name: string }[] }).tools.map(({ name }) => name);

    expect(names).toEqual(OBSERVABILITY_TOOLS.map(({ name }) => name));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      'variance_observability',
      'variance_summary',
      'variance_presentations',
      'variance_source_tests',
      'variance_run_signals',
      'variance_test_attention',
      'variance_distill',
      'variance_scenarios',
      'variance_diff',
    ]));
  });

  it('teaches an agent the discovery call and the limit of a distillation answer', () => {
    const response = handle(
      { jsonrpc: '2.0', id: 2, method: 'initialize' },
      () => ({}),
      OBSERVABILITY,
    );
    const instructions = (response!.result as { instructions: string }).instructions;

    expect(instructions).toContain('Start with `variance_observability`');
    expect(instructions).toContain('Unavailable evidence is not an empty measurement');
    expect(instructions).toContain('does not establish that a branch is safe to mock');
  });
});
