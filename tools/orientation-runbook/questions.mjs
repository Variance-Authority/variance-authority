import { QUESTIONS, invocationOf } from '@variance-authority/cli';
import { foundNothingAnswer, generationSourceIndex, readWorkspaceForAnswer, snapshotLine, workspaceGeneration } from '@variance-authority/help';
import { RECORDED, containment } from '@variance-authority/help/tools';
import { verbOf } from '@variance-authority/mcp/tools';
import { asOneQuestion, sourceIndexPath } from '@variance-authority/sense';

// Source eligibility and optional file membership are separate capabilities.
const tools = new Map(QUESTIONS.filter(row => row.source).map(row => [verbOf(row.tool), row.source]));

const details = error => ({ name: error.name, message: error.message });

/** Open the published generation; text predicates also read live source files. */
export async function openQuestions(root) {
  let tree;
  const help = await readWorkspaceForAnswer(root, {
    index: sourceIndexPath(root), justAnswer: true, tree: drawn => { tree = drawn; },
  });
  const sourceIndex = generationSourceIndex(help, root, sourceIndexPath(root));
  const generation = workspaceGeneration(help);
  const invocation = invocationOf({ root, tree, sourceIndex });
  const clock = () => performance.now();
  const resolve = question => {
    const tool = tools.get(question);
    if (!tool) throw new TypeError(`${question} has no eligible source reader`);
    return tool;
  };
  const drive = async (question, input) => {
    const tool = resolve(question);
    const at = RECORDED.includes(tool) || tool === containment ? undefined : generation;
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
    if (tool.files) {
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
    }
    try {
      const answer = await invoke('Tool.run', () => asOneQuestion(() => tool.run(help, input, invocation)));
      result.answer = `${answer}${at === undefined ? '' : `\n${snapshotLine(at, true)}`}\n`;
      result.status = 'answered';
    } catch (error) {
      const answer = foundNothingAnswer(error, undefined, at, true);
      if (answer === undefined) {
        result.error = details(error);
        result.status = 'error';
      } else {
        result.answer = `${answer}\n`;
        result.status = 'answered';
      }
    }
    return { ...result, apiCalls, apiCallCount: apiCalls.length };
  };
  return {
    drive,
    provenance: { generation, sourceIndex, sourceText: 'grep and discover text predicates read live checkout files' },
  };
}
