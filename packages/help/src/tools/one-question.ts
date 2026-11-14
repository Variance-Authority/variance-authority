import type { Tool } from '@variance-authority/mcp/tools';
import { asOneQuestion } from '@variance-authority/sense';

/**
 * `tool`, each answer one question to the source index: the chain is read and
 * checked once however many readers the answer asks, which for a name declared
 * in many files is once per declaration. Every tool is defined through it, so a
 * tool that comes to read the index later reads it once too; one that never
 * reads it opens nothing.
 */
export function oneQuestion<Subject>(tool: Tool<Subject>): Tool<Subject> {
  return { ...tool, run: (subject, input, invocation) => asOneQuestion(() => tool.run(subject, input, invocation)) };
}
