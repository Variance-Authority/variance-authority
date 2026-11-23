import Ajv from 'ajv';
import { QUESTIONS } from '@variance-authority/cli';
import { foundNothingAnswer, generationSourceIndex, readWorkspaceForAnswer, workspaceGeneration } from '@variance-authority/help';
import { verbOf } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';

// Eligibility is a capability, not a second list of command names. Composite
// questions without FileSet membership are outside this research increment.
const tools = new Map(QUESTIONS.filter(row => row.source?.files).map(row => [verbOf(row.tool), row.source]));

export function questionCatalogue() {
  return [...tools].map(([question, tool]) => ({ question, description: tool.description, inputSchema: tool.inputSchema }));
}

const details = error => ({ name: error.name, message: error.message });

/** Canonical text and complete membership are distinct, separately timed APIs. */
export function createQuestionDriver({ resolve, help, invocation, clock = () => performance.now() }) {
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  const validators = new WeakMap();
  const validate = (question, input) => {
    const tool = resolve(question);
    if (!validators.has(tool)) validators.set(tool, ajv.compile(tool.inputSchema));
    const check = validators.get(tool);
    if (!check(input)) throw new TypeError(`invalid ${question} input: ${ajv.errorsText(check.errors)}`);
  };
  const drive = async (question, input) => {
    const tool = resolve(question);
    const apiCalls = [];
    const invoke = async (api, operation) => {
      const start = clock();
      try {
        const value = await operation();
        apiCalls.push({ api, status: 'ok', elapsedMs: clock() - start });
        return value;
      } catch (error) {
        apiCalls.push({ api, status: 'error', elapsedMs: clock() - start, error: details(error) });
        throw error;
      }
    };
    const result = { membershipStatus: 'unknown' };
    try {
      // Shared caches, where present, can serve the following canonical answer.
      const membership = await invoke('Tool.files', () => tool.files(help, input, invocation));
      if (!(membership.files instanceof Map)) throw new TypeError('Tool.files did not return a FileSet');
      result.files = [...membership.files].map(([file, lines]) => ({ file, lines: [...lines] }));
      result.unread = membership.unread;
      result.qualifications = membership.qualifications ? Object.fromEntries(membership.qualifications) : undefined;
      result.membershipStatus = membership.unread?.length ? 'incomplete' : 'complete';
    } catch (error) {
      result.membershipError = details(error);
    }
    try {
      result.answer = await invoke('Tool.run', () => tool.run(help, input, invocation));
      result.status = 'answered';
    } catch (error) {
      const answer = foundNothingAnswer(error, undefined, workspaceGeneration(help), true);
      if (answer === undefined) {
        result.error = details(error);
        result.status = 'error';
      } else {
        result.answer = answer;
        result.status = 'answered';
      }
    }
    return { ...result, apiCalls, apiCallCount: apiCalls.length, underlyingReaderExecutions: null };
  };
  return { validate, drive };
}

/** Open only the published generation. No inventory, comparison, or refresh. */
export async function openQuestions(root) {
  let tree;
  const help = await readWorkspaceForAnswer(root, {
    index: sourceIndexPath(root), justAnswer: true, tree: drawn => { tree = drawn; },
  });
  const sourceIndex = generationSourceIndex(help, root, sourceIndexPath(root));
  const resolve = question => {
    const tool = tools.get(question);
    if (!tool) throw new TypeError(`${question} has no eligible source membership reader`);
    return tool;
  };
  return {
    ...createQuestionDriver({ resolve, help, invocation: { root, tree, sourceIndex } }),
    provenance: { generation: workspaceGeneration(help), sourceIndex },
  };
}
